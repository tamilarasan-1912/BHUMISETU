import type { NextFunction, Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
export const tooMany = (msg = 'Too many requests') => new HttpError(429, 'RATE_LIMITED', msg);
export const upstreamUnavailable = (msg: string) => new HttpError(503, 'UPSTREAM_UNAVAILABLE', msg);

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export function parse<T extends ZodTypeAny>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      `Invalid ${what}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

/* -------------------------------------------------------------------------- */
/* Privacy helpers                                                            */
/* -------------------------------------------------------------------------- */

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'sri', 'shri', 'smt', 'dr', 'thiru', 'selvi', 'smt.', 'shri.']);

/**
 * Masks a person's name for citizen-facing views. Every identifying token is
 * reduced to its first character; only honorifics and single-letter initials
 * survive, so a name written without an honorific ("Lakshmi Narayanan") cannot
 * leak its given name.
 */
export function maskPersonName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts
    .map((t) => {
      const bare = t.replace(/[^A-Za-z]/g, '');
      if (HONORIFICS.has(t.toLowerCase()) || HONORIFICS.has(`${bare.toLowerCase()}.`)) return t;
      if (bare.length <= 1) return t;
      const dots = t.replace(/[^.]/g, '');
      return `${t[0]}${'•'.repeat(Math.max(1, bare.length - 1))}${dots}`;
    })
    .join(' ');
}

/**
 * Citizen-facing records never expose exact monetary liability amounts or
 * internal identifiers; they expose the status instead.
 */
export function maskAmount(value: number | string | null | undefined): string {
  const n = value === null || value === undefined ? 0 : Number(value);
  if (!Number.isFinite(n) || n === 0) return 'No dues recorded';
  if (n < 5000) return 'Dues recorded — minimal band';
  if (n < 50000) return 'Dues recorded — moderate band';
  return 'Dues recorded — significant band';
}

export function maskAssessmentNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  return `${v.slice(0, 3)}••••${v.slice(-2)}`;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting (per-client, in-process)                                     */
/* -------------------------------------------------------------------------- */

const limiterBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: { windowMs: number; max: number; key: string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const client = req.ip ?? 'unknown';
    const bucketKey = `${opts.key}:${client}`;
    const now = Date.now();
    const b = limiterBuckets.get(bucketKey);
    if (!b || b.resetAt < now) {
      limiterBuckets.set(bucketKey, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > opts.max) {
      return next(tooMany(`Rate limit exceeded for ${opts.key}. Retry shortly.`));
    }
    return next();
  };
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export function envelope<T>(items: T[], total: number, limit: number, offset: number) {
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}
