import dotenv from "dotenv";
import path from "node:path";

export const ENV_PATH = process.env.ENV_PATH || "/opt/remote-sim-gateway/.env";

dotenv.config({
  path: ENV_PATH,
  quiet: true
});

export const config = {
  port: readNumber("PORT", 3000),
  allowedLoginEmail: process.env.ALLOWED_LOGIN_EMAIL?.trim().toLowerCase() || "",
  sessionTimeoutMs: readNumber("SESSION_TIMEOUT", 300) * 1000,
  loginCodeExpireMs: readNumber("LOGIN_CODE_EXPIRE", 300) * 1000,
  maxLoginAttempts: readNumber("MAX_LOGIN_ATTEMPTS", 5),
  smsSendIntervalMs: readNumber("SMS_SEND_INTERVAL", 60) * 1000,
  sqlitePath: process.env.SQLITE_PATH || path.resolve(process.cwd(), "data", "remote-sim-gateway.sqlite"),
  auditLogPath: process.env.AUDIT_LOG_PATH || path.resolve(process.cwd(), "logs", "audit.log"),
  smtp: {
    host: process.env.SMTP_HOST?.trim() || "",
    port: readNumber("SMTP_PORT", 587),
    secure: readBoolean("SMTP_SECURE") ?? readNumber("SMTP_PORT", 587) === 465,
    user: process.env.SMTP_USER?.trim() || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM?.trim() || process.env.SMS_FORWARD_FROM?.trim() || process.env.SMTP_USER?.trim() || ""
  },
  smsForward: {
    to: process.env.SMS_FORWARD_TO?.trim() || "",
    from: process.env.SMS_FORWARD_FROM?.trim() || process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || "",
    subjectPrefix: process.env.SMS_FORWARD_SUBJECT_PREFIX?.trim() || "[Remote SIM Gateway]"
  },
  cookieSecure: readBoolean("SESSION_COOKIE_SECURE") ?? false
};

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function readBoolean(name: string): boolean | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  return null;
}
