# Security

## Authentication

BHUMISETU uses **session/JWT authentication** implemented in `server/src/auth/`.

- `POST /api/auth/login` verifies the password with **bcrypt** (`bcryptjs`) against a stored
  hash. Plaintext passwords are never stored, logged or returned.
- A successful login issues a signed token (HMAC, `JWT_SECRET`) and also sets an httpOnly,
  SameSite session cookie. Both a bearer header and the cookie are accepted.
- Sessions are recorded in the `sessions` table and can be invalidated by logout.
- `JWT_SECRET` **must** be set in production — `assertConfig()` refuses to start the server
  in production without it. In development a random per-boot secret is generated so local
  sessions are invalidated on restart rather than shipping a predictable key.
- Login is rate limited to blunt credential stuffing.

## Authorization (RBAC)

Authorization is enforced by **permission codes checked at the endpoint**, never by hiding
UI. Every protected route declares its requirement, e.g. `requirePermission('audit.read')`.
A caller lacking a permission receives `403 FORBIDDEN` naming the missing permission; the
UI renders that as an explicit "Missing permission: …" state rather than a blank page.

### Roles

`CITIZEN`, `FIELD_OFFICER`, `REVENUE_OFFICER`, `REGISTRATION_OFFICER`, `MUNICIPAL_OFFICER`,
`PLANNING_OFFICER`, `JUDICIARY_VIEWER`, `GIS_ADMIN`, `SYSTEM_ADMIN`.

Roles map to granular permissions through `role_permissions`, so capability changes are data
changes and are themselves audited.

### Representative permissions

| Role | Representative permissions |
| --- | --- |
| CITIZEN | read permitted parcel information, create a service request, view own cases |
| FIELD_OFFICER | assigned parcel/case access, field verification |
| REVENUE_OFFICER | RoR / ownership workflow, findings review |
| REGISTRATION_OFFICER | registration records |
| MUNICIPAL_OFFICER | tax and planning records |
| PLANNING_OFFICER | planning and building records |
| JUDICIARY_VIEWER | judiciary records, read-only |
| GIS_ADMIN | layers, sources, geometry |
| SYSTEM_ADMIN | users, roles, rule and workflow configuration, audit |

Protected surfaces: `/admin`, `/studio`, `/officer`, `/cases`, `/gateway`, `/audit` and their
API counterparts. `/officer` additionally requires an officer or admin role and scopes the
queue to the caller's role.

## Citizen masking

Citizen and anonymous views are masked at the service boundary by a per-role policy
(`auth/policy.ts`), not by the client. Masked:

- **Party names** — the identifying surname is replaced with a mask while the initial stays
  legible (`K. Meenakshi` → `K. M••••••••`). A name written without an honorific cannot leak
  its given name.
- **Monetary amounts and dues** — replaced with a band, never an exact liability figure.
- **Assessment numbers** — partially masked.
- **Internal officer notes** — omitted entirely (`includeInternalNotes: false`).

Masking is applied to the **whole serialized passport**, including free text. Finding
descriptions, evidence values and timeline prose embed raw names inside sentences, so a
recursive scrub replaces every occurrence of each known party name with its masked form.
Without this, a citizen view could mask the ownership block while leaking the same name
through an evidence card. This is covered by a regression test.

Citizens never see internal officer notes, private documents or unmasked identifiers.

## Data protection and privacy

- **No Aadhaar.** The platform does not collect Aadhaar and implements no Aadhaar
  authentication.
- **Minimal personal data.** Only what a land record requires: names, roles and masked
  contact details. No national identifier is stored on a parcel.
- **Role-specific access.** Records are projected according to the caller's role; a citizen
  sees a strictly smaller view than an officer.
- **Consent records** are modelled (`consent_records`) for future consent-gated flows.

## Input, query and transport safety

- **Parameterized queries** throughout (`pg` / Kysely with bound parameters). No string
  concatenation of user input into SQL.
- **Schema validation** on every endpoint via zod — types, ranges and lengths are enforced
  before the service layer.
- **Bounded external requests** — timeouts, retries, radius limits and rate limits on
  Overpass and other adapters, so the platform cannot be used to amplify load at an upstream.
- **Rate limiting** on login, search and the OSM context endpoint.
- **Safe error messages** — a consistent envelope with a `requestId`; stack traces, database
  URLs, tokens and secrets are never serialized to the client.
- **CSRF posture** — state-changing requests are authenticated by bearer token or an
  httpOnly SameSite cookie; the JSON API does not accept form-encoded cross-site posts.

## Secrets

- All credentials come from environment variables and are read only on the server.
  Recognized names include `DATABASE_URL`, `JWT_SECRET`, `COPERNICUS_CLIENT_ID`,
  `COPERNICUS_CLIENT_SECRET`, `DATA_GOV_IN_API_KEY`, `OTHER_SOURCE_API_KEY`, `AI_API_KEY`.
- **No secret is ever exposed to the frontend bundle.** The client receives only the API
  base URL and its own credentials.
- `.env` files are git-ignored; no credential is committed.
- The Copernicus and AI integrations are optional and the application runs fully without
  them.

## Audit

Security-relevant actions write **immutable-style audit records** with `auditId`, timestamp,
actor, role, action, entity type and id, before/after snapshots, source, reason and
`requestId`. Audit rows are append-only through the application; they are never silently
modified. Recorded actions include login, case creation and status change, finding status
change, rule and workflow configuration changes, source enable/disable, passport views and
service-request transitions. The trail is inspectable at `/studio` → Audit and via
`GET /api/audit` for callers holding `audit.read`.

## Optional AI

If an AI provider is configured it is used only for advisory features (classification,
summarization, natural-language search) and is **never a hard dependency**: all core
functionality, including search, works deterministically without it. Any AI output is
labelled as AI-generated with its confidence and source evidence, and the assistant does not
provide legal advice.

## Reporting

Security concerns should be reported to the maintainers rather than filed publicly with
reproduction data that includes personal information.
