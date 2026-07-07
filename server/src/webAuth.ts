import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db.js";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { sendLoginCodeEmail } from "./mailer.js";
import { sendLoginCodeTelegram } from "./telegram.js";

const SESSION_COOKIE = "rsg_session";

type LoginCodeRow = {
  email: string;
  code_hash: string;
  expires_at: number;
  attempts: number;
  used_at: number | null;
};

type LoginIdentity = {
  key: string;
  label: string;
};

export type ActiveSession = {
  sessionId: string;
  email: string;
  expiresAt: number;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS login_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_login_codes_email
    ON login_codes(email, created_at DESC);

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
    ON sessions(expires_at);
`);

const insertLoginCode = db.prepare(`
  INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
  VALUES (@email, @codeHash, @expiresAt, 0, @createdAt)
`);

const getLatestLoginCode = db.prepare(`
  SELECT email, code_hash, expires_at, attempts, used_at
  FROM login_codes
  WHERE email = @email
  ORDER BY created_at DESC
  LIMIT 1
`);

const incrementLoginAttempts = db.prepare(`
  UPDATE login_codes
  SET attempts = attempts + 1
  WHERE email = @email AND code_hash = @codeHash
`);

const markLoginCodeUsed = db.prepare(`
  UPDATE login_codes
  SET used_at = @usedAt
  WHERE email = @email AND code_hash = @codeHash
`);

const deleteAllSessions = db.prepare("DELETE FROM sessions");

const insertSession = db.prepare(`
  INSERT INTO sessions (session_id, email, expires_at, created_at, last_seen_at)
  VALUES (@sessionId, @email, @expiresAt, @createdAt, @lastSeenAt)
`);

const getSession = db.prepare(`
  SELECT session_id AS sessionId, email, expires_at AS expiresAt
  FROM sessions
  WHERE session_id = @sessionId
`);

const refreshSession = db.prepare(`
  UPDATE sessions
  SET expires_at = @expiresAt, last_seen_at = @lastSeenAt
  WHERE session_id = @sessionId
`);

const deleteSession = db.prepare("DELETE FROM sessions WHERE session_id = @sessionId");
const deleteExpiredSessions = db.prepare("DELETE FROM sessions WHERE expires_at <= @now");

export async function requestLoginCode(req: Request, res: Response): Promise<void> {
  const email = normalizeEmail(req.body?.email);
  const channel = normalizeLoginCodeChannel(req.body?.channel);
  const identity = resolveLoginIdentity(channel, email);

  if (!identity.ok) {
    audit("auth_request_code_blocked", { channel, email, reason: identity.error, ip: req.ip });
    res.status(identity.status).json({ error: identity.error });
    return;
  }

  const code = createLoginCode();
  const now = Date.now();

  insertLoginCode.run({
    email: identity.value.key,
    codeHash: hashLoginCode(identity.value.key, code),
    expiresAt: now + config.loginCodeExpireMs,
    createdAt: now
  });

  try {
    await sendLoginCode(channel, email, code);
    audit("auth_request_code", { identity: identity.value.key, channel, ip: req.ip });
    res.json({ ok: true, channel });
  } catch (error) {
    audit("auth_request_code_failed", {
      identity: identity.value.key,
      channel,
      ip: req.ip,
      error: getErrorMessage(error)
    });
    res.status(503).json({ error: `${channel}_not_available` });
  }
}

export function login(req: Request, res: Response): void {
  const email = normalizeEmail(req.body?.email);
  const channel = normalizeLoginCodeChannel(req.body?.channel);
  const code = String(req.body?.code || "").trim();
  const identity = resolveLoginIdentity(channel, email);

  if (!identity.ok) {
    audit("auth_login_blocked", { channel, email, ip: req.ip, reason: identity.error });
    res.status(identity.status).json({ error: identity.error });
    return;
  }

  const row = getLatestLoginCode.get({ email: identity.value.key }) as LoginCodeRow | undefined;
  const now = Date.now();

  if (!row || row.used_at || row.expires_at <= now) {
    audit("auth_login_failed", {
      identity: identity.value.key,
      channel,
      ip: req.ip,
      reason: "code_expired_or_missing"
    });
    res.status(401).json({ error: "invalid_code" });
    return;
  }

  if (row.attempts >= config.maxLoginAttempts) {
    audit("auth_login_blocked", {
      identity: identity.value.key,
      channel,
      ip: req.ip,
      reason: "too_many_attempts"
    });
    res.status(429).json({ error: "too_many_attempts" });
    return;
  }

  if (row.code_hash !== hashLoginCode(identity.value.key, code)) {
    incrementLoginAttempts.run({ email: identity.value.key, codeHash: row.code_hash });
    audit("auth_login_failed", { identity: identity.value.key, channel, ip: req.ip, reason: "bad_code" });
    res.status(401).json({ error: "invalid_code" });
    return;
  }

  const sessionId = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + config.sessionTimeoutMs;

  deleteAllSessions.run();
  markLoginCodeUsed.run({ email: identity.value.key, codeHash: row.code_hash, usedAt: now });
  insertSession.run({
    sessionId,
    email: identity.value.label,
    expiresAt,
    createdAt: now,
    lastSeenAt: now
  });

  setSessionCookie(res, sessionId);
  audit("auth_login", { identity: identity.value.key, channel, ip: req.ip });
  res.json({ ok: true, email: identity.value.label, expiresAt: new Date(expiresAt).toISOString() });
}

export function logout(req: Request, res: Response): void {
  const sessionId = getSessionCookie(req);
  const session = sessionId ? findActiveSession(sessionId, false) : null;

  if (sessionId) {
    deleteSession.run({ sessionId });
  }

  clearSessionCookie(res);
  audit("auth_logout", { email: session?.email, ip: req.ip });
  res.json({ ok: true });
}

export function sessionStatus(req: Request, res: Response): void {
  const sessionId = getSessionCookie(req);
  const session = sessionId ? findActiveSession(sessionId, true) : null;

  if (!session) {
    res.status(401).json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    email: session.email,
    expiresAt: new Date(session.expiresAt).toISOString()
  });
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const sessionId = getSessionCookie(req);
  const session = sessionId ? findActiveSession(sessionId, true) : null;

  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  res.locals.session = session;
  next();
}

export function getResponseSession(res: Response): ActiveSession {
  return res.locals.session as ActiveSession;
}

function findActiveSession(sessionId: string, extend: boolean): ActiveSession | null {
  const now = Date.now();
  deleteExpiredSessions.run({ now });

  const row = getSession.get({ sessionId }) as ActiveSession | undefined;
  if (!row || row.expiresAt <= now) {
    return null;
  }

  if (extend) {
    const nextExpiresAt = now + config.sessionTimeoutMs;
    refreshSession.run({ sessionId, expiresAt: nextExpiresAt, lastSeenAt: now });
    return { ...row, expiresAt: nextExpiresAt };
  }

  return row;
}

function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
    maxAge: Math.floor(config.sessionTimeoutMs / 1000),
    path: "/"
  }));
}

function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.cookieSecure,
    maxAge: 0,
    path: "/"
  }));
}

function getSessionCookie(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  return cookies[SESSION_COOKIE] || null;
}

function parseCookieHeader(header: string): Record<string, string> {
  return header.split(";").reduce<Record<string, string>>((cookies, part) => {
    const [name, ...valueParts] = part.trim().split("=");
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(valueParts.join("="));
    return cookies;
  }, {});
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; sameSite: "Lax"; secure: boolean; maxAge: number; path: string }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function createLoginCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashLoginCode(email: string, code: string): string {
  return crypto.createHash("sha256").update(`${email}:${code}`).digest("hex");
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeLoginCodeChannel(value: unknown): "email" | "telegram" {
  return value === "telegram" ? "telegram" : "email";
}

function resolveLoginIdentity(
  channel: "email" | "telegram",
  email: string
): { ok: true; value: LoginIdentity } | { ok: false; status: number; error: string } {
  if (channel === "telegram") {
    if (!config.telegram.botToken || !config.telegram.chatId) {
      return { ok: false, status: 503, error: "telegram_not_available" };
    }

    return {
      ok: true,
      value: {
        key: `telegram:${config.telegram.chatId}`,
        label: "Telegram"
      }
    };
  }

  if (!config.allowedLoginEmail) {
    return { ok: false, status: 503, error: "login_not_configured" };
  }

  if (email !== config.allowedLoginEmail) {
    return { ok: false, status: 403, error: "email_not_allowed" };
  }

  return {
    ok: true,
    value: {
      key: email,
      label: email
    }
  };
}

async function sendLoginCode(channel: "email" | "telegram", email: string, code: string): Promise<void> {
  if (channel === "telegram") {
    await sendLoginCodeTelegram(code);
    return;
  }

  await sendLoginCodeEmail(email, code);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
