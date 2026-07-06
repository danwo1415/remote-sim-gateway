import nodemailer from "nodemailer";

type SmsPayload = {
  from?: unknown;
  body?: unknown;
  timestamp?: unknown;
  queuedAt?: unknown;
};

type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
  to: string;
  subjectPrefix: string;
};

let transporter: nodemailer.Transporter | null = null;
let transporterKey: string | null = null;
let warnedMissingConfig = false;

export async function forwardIncomingSmsEmail(deviceId: string, payload: SmsPayload): Promise<boolean> {
  const config = getMailConfig();

  if (!config) {
    if (!warnedMissingConfig) {
      console.warn("[mail] SMS email forwarding disabled. Configure SMTP_HOST and SMS_FORWARD_TO.");
      warnedMissingConfig = true;
    }
    return false;
  }

  const fromNumber = stringify(payload.from, "unknown");
  const body = stringify(payload.body, "");
  const receivedAt = formatTimestamp(payload.timestamp);
  const queuedAt = payload.queuedAt ? formatTimestamp(payload.queuedAt) : null;
  const subject = `${config.subjectPrefix} SMS from ${fromNumber}`.slice(0, 160);

  const lines = [
    "Remote SIM Gateway received a new SMS.",
    "",
    `Device: ${deviceId}`,
    `From: ${fromNumber}`,
    `Received at: ${receivedAt}`,
    queuedAt ? `Queued at: ${queuedAt}` : null,
    "",
    "Message:",
    body
  ].filter((line): line is string => line !== null);

  await getTransporter(config).sendMail({
    from: config.from,
    to: config.to,
    subject,
    text: lines.join("\n")
  });

  return true;
}

function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const to = process.env.SMS_FORWARD_TO?.trim();

  if (!host || !to) {
    return null;
  }

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE) ?? port === 465;

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    from: process.env.SMS_FORWARD_FROM?.trim() || user || "Remote SIM Gateway <no-reply@localhost>",
    to,
    subjectPrefix: process.env.SMS_FORWARD_SUBJECT_PREFIX?.trim() || "[Remote SIM Gateway]"
  };
}

function getTransporter(config: MailConfig): nodemailer.Transporter {
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    authUser: config.auth?.user,
    from: config.from,
    to: config.to
  });

  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth
    });
    transporterKey = key;
  }

  return transporter;
}

function stringify(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}

function formatTimestamp(value: unknown): string {
  if (typeof value === "number") {
    return toIsoString(new Date(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return toIsoString(new Date(asNumber));
    }
    return toIsoString(new Date(value));
  }

  return new Date().toISOString();
}

function toIsoString(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  return null;
}
