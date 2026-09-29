import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, getToken, setToken } from '../services/api';
import type { AppMeta, SessionUser } from '../types/api';

export type ThemeName = 'dark' | 'light';

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  title: string;
  body?: string;
}

interface AppStateValue {
  meta: AppMeta | null;
  metaLoading: boolean;
  metaError: string | null;
  theme: ThemeName;
  toggleTheme: () => void;
  user: SessionUser | null;
  authReady: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  /** Renders an ApiError consistently across the app. */
  reportError: (err: unknown, context?: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const THEME_KEY = 'bhumisetu.theme';

function readTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage unavailable */
  }
  // Default to the dark civic GIS interface.
  return 'dark';
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeName>(readTheme);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toastSeq = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    setMetaLoading(true);
    api
      .meta(controller.signal)
      .then((m) => {
        setMeta(m);
        setMetaError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMetaError(err instanceof Error ? err.message : 'Unable to load platform metadata');
      })
      .finally(() => setMetaLoading(false));
    return () => controller.abort();
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      toastSeq.current += 1;
      const id = `toast-${toastSeq.current}`;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      const ttl = t.kind === 'error' ? 9000 : 5200;
      window.setTimeout(() => dismissToast(id), ttl);
    },
    [dismissToast],
  );

  const reportError = useCallback(
    (err: unknown, context?: string) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      let title = 'Something went wrong';
      let body: string | undefined;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          title = 'Sign-in required';
          body = 'Your session has expired. Sign in again to continue.';
          setUser(null);
          setToken(null);
        } else if (err.unavailable) {
          title = 'Not enabled in this deployment';
          body = err.message;
        } else {
          title = context ? `${context} failed` : 'Request failed';
          body = err.message;
        }
      } else if (err instanceof Error) {
        body = err.message;
      }
      pushToast({ kind: 'error', title, body });
    },
    [pushToast],
  );

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const me = await api.me();
      setUser(me.user);
    } catch {
      setUser(null);
      setToken(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser().finally(() => setAuthReady(true));
  }, [refreshUser]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      setToken(res.token);
      setUser(res.user);
      pushToast({ kind: 'success', title: `Signed in as ${res.user.fullName}`, body: res.user.roleLabel });
    },
    [pushToast],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* the session is being discarded regardless */
    }
    setToken(null);
    setUser(null);
    pushToast({ kind: 'info', title: 'Signed out' });
  }, [pushToast]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      meta,
      metaLoading,
      metaError,
      theme,
      toggleTheme,
      user,
      authReady,
      login,
      logout,
      refreshUser,
      toasts,
      pushToast,
      dismissToast,
      reportError,
      paletteOpen,
      setPaletteOpen,
    }),
    [
      meta,
      metaLoading,
      metaError,
      theme,
      toggleTheme,
      user,
      authReady,
      login,
      logout,
      refreshUser,
      toasts,
      pushToast,
      dismissToast,
      reportError,
      paletteOpen,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
