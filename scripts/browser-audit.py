#!/usr/bin/env python3
"""
Drive a headless Chromium over the DevTools Protocol and record every console
message and uncaught exception while visiting each route.

This exists because the acceptance criteria require a clean browser console and
a real viewport check, and no browser-automation package is available in this
environment. Chromium and the CDP websocket are, so the checks run against the
real rendered application rather than a proxy for it.

Usage:
    python3 scripts/browser-audit.py [--base http://localhost:12000] [--width 390] [--height 844]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

import websocket

ROUTES = [
    ("/", "map"),
    ("/parcels", "parcel register"),
    ("/intelligence", "intelligence workspace"),
    ("/cases", "case queue"),
    ("/cases/BHM-DEMO-0001", "case detail (by display number)"),
    ("/officer", "officer dashboard"),
    ("/analytics", "analytics"),
    ("/gateway", "department gateway"),
    ("/sources", "data source catalogue"),
    ("/studio", "administrative studio"),
    ("/login", "sign in"),
    ("/passport/PARC-B", "land passport"),
    ("/citizen", "citizen portal"),
]

# A missing tile or a 4xx from a public upstream we already degrade gracefully on
# is not a defect in this application; anything else is reported.
IGNORABLE = (
    "favicon",
    "tile.openstreetmap.org",
    "bhuvan",
    "overpass",
    "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_INTERNET_DISCONNECTED",
    "net::ERR_CONNECTION",
)


class Session:
    """A CDP session bound to one page target.

    Responses and events share the socket, so the reader thread files them
    separately: a message carrying an id resolves the matching send(), anything
    else is an observation for the reporter.
    """

    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=60)
        self.next_id = 1
        self.lock = threading.Lock()
        self.events: list[dict] = []
        self.responses: dict[int, dict] = {}
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        while True:
            try:
                raw = self.ws.recv()
            except Exception:
                return
            if not raw:
                return
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            with self.lock:
                if "id" in msg and msg["id"] is not None:
                    self.responses[msg["id"]] = msg
                elif "method" in msg:
                    self.events.append(msg)

    def send(self, method: str, params: dict | None = None) -> dict:
        with self.lock:
            msg_id = self.next_id
            self.next_id += 1
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        deadline = time.time() + 60
        while time.time() < deadline:
            with self.lock:
                if msg_id in self.responses:
                    return self.responses.pop(msg_id)
            time.sleep(0.01)
        raise TimeoutError(f"{method} did not return")

    def drain(self) -> list[dict]:
        with self.lock:
            events, self.events = self.events, []
        return events

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass


def find_page_ws_url(port: int) -> str:
    """Wait for a page target and return its websocket URL.

    Runtime, Log and Page domains only exist on a page target; the browser-level
    endpoint rejects them.
    """
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
                targets = json.load(r)
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("no chromium page target became available")


def classify(events: list[dict]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for ev in events:
        method = ev.get("method")
        params = ev.get("params", {})
        if method == "Runtime.consoleAPICalled":
            level = params.get("type")
            text = " ".join(
                str(a.get("value") if a.get("value") is not None else a.get("description", ""))
                for a in params.get("args", [])
            )
            if level in ("error", "assert"):
                if not any(tok in text for tok in IGNORABLE):
                    errors.append(f"console.error: {text[:400]}")
            elif level == "warning" and text.strip():
                warnings.append(f"console.warn: {text[:200]}")
        elif method == "Runtime.exceptionThrown":
            detail = params.get("exceptionDetails", {})
            text = detail.get("exception", {}).get("description") or detail.get("text", "")
            if not any(tok in text for tok in IGNORABLE):
                errors.append(f"uncaught exception: {str(text)[:400]}")
        elif method == "Log.entryAdded":
            entry = params.get("entry", {})
            if entry.get("level") == "error":
                text = f"{entry.get('text', '')} {entry.get('url', '')}"
                if not any(tok in text for tok in IGNORABLE):
                    errors.append(f"log.error: {text[:400]}")
    return errors, warnings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:12000")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--label", default="desktop")
    args = ap.parse_args()

    binary = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    if not binary:
        print("chromium not found", file=sys.stderr)
        return 2

    port = 9222 + abs(hash(args.label)) % 500
    profile = tempfile.mkdtemp(prefix="bhumi-cdp-")
    proc = subprocess.Popen(
        [
            binary,
            "--headless=new",
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile}",
            f"--window-size={args.width},{args.height}",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-sandbox",
            "--remote-allow-origins=*",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    total_errors = 0
    try:
        ws_url = find_page_ws_url(port)
        s = Session(ws_url)
        s.send("Runtime.enable")
        s.send("Log.enable")
        s.send("Page.enable")
        s.send("Network.enable")
        s.send("Emulation.setDeviceMetricsOverride", {
            "width": args.width, "height": args.height, "deviceScaleFactor": 1, "mobile": args.width < 700,
        })
        print(f"=== browser audit [{args.label}] {args.width}x{args.height} @ {args.base} ===")
        overflow_probe = (
            "JSON.stringify({"
            "  scrollW: document.documentElement.scrollWidth,"
            "  clientW: document.documentElement.clientWidth,"
            "  nav: !!document.querySelector('nav'),"
            "  main: !!document.querySelector('main') || !!document.querySelector('#root > *')"
            "})"
        )
        for path, label in ROUTES:
            s.drain()
            s.send("Page.navigate", {"url": args.base + path})
            time.sleep(3.0)
            events = s.drain()
            errors, warnings = classify(events)
            total_errors += len(errors)
            status = "OK " if not errors else "ERR"
            print(f"{status} {label:<34} {path}")
            for e in errors:
                print(f"      ! {e}")
            for w in warnings[:2]:
                print(f"      ~ {w}")

            # A page wider than the viewport means the layout is clipped or the
            # user must scroll sideways, which counts as a mobile failure even
            # when nothing throws.
            probe = s.send("Runtime.evaluate", {"expression": overflow_probe, "returnByValue": True})
            raw = probe.get("result", {}).get("result", {}).get("value")
            if raw:
                m = json.loads(raw)
                overflow = m["scrollW"] - m["clientW"]
                if overflow > 2:
                    total_errors += 1
                    print(f"      ! horizontal overflow: scrollWidth {m['scrollW']} > clientWidth {m['clientW']} (+{overflow}px)")
                elif not m["main"]:
                    total_errors += 1
                    print("      ! no rendered content container found")
        s.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(f"=== {args.label}: {total_errors} console error(s) across {len(ROUTES)} route(s) ===")
    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main())
