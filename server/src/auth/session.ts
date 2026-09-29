import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { rawPool } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { forbidden, unauthorized } from '../helpers/http.js';
import { PERMISSIONS, permissionsForRole, ROLES } from '../data/roles.js';
import type { Action, Resource } from './policy.js';

export interface SessionUser {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  roleLabel: string;
  isOfficer: boolean;
  isAdmin: boolean;
  permissions: string[];
  district: string | null;
  department: string | null;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      requestId?: string;
    }
  }
}

interface TokenPayload {
  sub: string;
  sid: string;
  role: string;
}

export async function login(
  username: string,
  password: string,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ token: string; user: SessionUser; expiresAt: string }> {
  const res = await rawPool.query(
    `SELECT u.*, r.label AS role_label, r.is_officer, r.is_admin
     FROM users u JOIN roles r ON r.code = u.role_code
     WHERE lower(u.username) = lower($1)`,
    [username],
  );
  const row = res.rows[0];

  // Constant-ish work on the failure path avoids revealing whether a username
  // exists via response timing.
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = bcrypt.compareSync(password, String(hash));
  if (!row || !ok || !row.active) {
    throw unauthorized('Invalid credentials');
  }

  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.jwtExpirySeconds * 1000);
  await rawPool.query(
    `INSERT INTO sessions (session_id, user_id, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5)`,
    [sessionId, row.user_id, expiresAt, ctx.userAgent ?? null, ctx.ip ?? null],
  );
  await rawPool.query(`UPDATE users SET last_login_at = now() WHERE user_id = $1`, [row.user_id]);

  const token = jwt.sign({ sub: String(row.user_id), sid: sessionId, role: String(row.role_code) } satisfies TokenPayload, config.jwtSecret, {
    expiresIn: config.jwtExpirySeconds,
  });

  const user: SessionUser = {
    userId: String(row.user_id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: String(row.role_code),
    roleLabel: String(row.role_label),
    isOfficer: Boolean(row.is_officer),
    isAdmin: Boolean(row.is_admin),
    permissions: permissionsForRole(String(row.role_code)),
    district: row.district ? String(row.district) : null,
    department: row.department ? String(row.department) : null,
    sessionId,
  };

  return { token, user, expiresAt: expiresAt.toISOString() };
}

export async function logout(sessionId: string): Promise<void> {
  await rawPool.query(`UPDATE sessions SET revoked = true WHERE session_id = $1`, [sessionId]);
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = req.headers.cookie;
  if (cookie) {
    const m = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('bhumisetu_session='));
    if (m) return decodeURIComponent(m.split('=').slice(1).join('='));
  }
  return null;
}

/** Attaches req.user when a valid, non-revoked session is presented. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
    const res = await rawPool.query(
      `SELECT u.*, r.label AS role_label, r.is_officer, r.is_admin, s.revoked, s.expires_at
       FROM users u
       JOIN roles r ON r.code = u.role_code
       JOIN sessions s ON s.session_id = $2
       WHERE u.user_id = $1 AND s.user_id = u.user_id`,
      [payload.sub, payload.sid],
    );
    const row = res.rows[0];
    if (!row || row.revoked || new Date(row.expires_at).getTime() < Date.now() || !row.active) {
      return next();
    }
    req.user = {
      userId: String(row.user_id),
      username: String(row.username),
      fullName: String(row.full_name),
      role: String(row.role_code),
      roleLabel: String(row.role_label),
      isOfficer: Boolean(row.is_officer),
      isAdmin: Boolean(row.is_admin),
      permissions: permissionsForRole(String(row.role_code)),
      district: row.district ? String(row.district) : null,
      department: row.department ? String(row.department) : null,
      sessionId: payload.sid,
    };
    next();
  } catch {
    // A bad or expired token is simply "not authenticated".
    next();
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!req.user.permissions.includes(permission)) {
      return next(forbidden(`Missing permission: ${permission}`));
    }
    next();
  };
}

export function requireOfficer(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (!req.user.isOfficer && !req.user.isAdmin) return next(forbidden('Officer role required'));
  next();
}

/* -------------------------------------------------------------------------- */
/* Role capability matrix (documentation + Studio surface)                    */
/* -------------------------------------------------------------------------- */

export function capabilityMatrix() {
  return ROLES.map((r) => ({
    role: r.code,
    label: r.label,
    description: r.description,
    isOfficer: r.isOfficer,
    isAdmin: r.isAdmin,
    departments: r.departments,
    permissions: r.permissions.map((code) => ({
      code,
      label: PERMISSIONS.find((p) => p.code === code)?.label ?? code,
    })),
  }));
}

export function can(user: SessionUser | undefined, permission: string): boolean {
  return Boolean(user?.permissions.includes(permission));
}

/** Guards a route with the policy engine rather than a raw permission string. */
export function authorize(action: Action, resource: Resource) {
  return (req: Request, _res: Response, next: NextFunction) => {
    void import('./policy.js').then(({ isAllowed }) => {
      if (!req.user) return next(unauthorized());
      if (!isAllowed(req.user.role, action, resource)) {
        return next(forbidden(`Action ${action} on ${resource} is not permitted for role ${req.user.role}`));
      }
      next();
    });
  };
}
