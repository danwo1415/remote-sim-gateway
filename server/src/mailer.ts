import nodemailer from "nodemailer";
import { config } from "./config.js";

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

export async function sendLoginCodeEmail(email: string, code: string): Promise<void> {
  const config = getMailConfig();

  if (!config) {
    throw new Error("SMTP is not configured");
  }

  await sendMail({
    to: email,
    subject: "[Remote SIM Gateway] Login code",
    text: [
      "Your Remote SIM Gateway login code is:",
      "",
      code,
      "",
      "This code expires in 5 minutes."
    ].join("\n")
  });
}

export async function forwardIncomingSmsEmail(deviceId: string, payload: SmsPayload): Promise<boolean> {
  const mailConfig = getMailConfig();
  const to = config.smsForward.to;

  if (!mailConfig || !to) {
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
  const subject = `${config.smsForward.subjectPrefix} SMS from ${fromNumber}`.slice(0, 160);

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

  await getTransporter(mailConfig).sendMail({
    from: config.smsForward.from || mailConfig.from,
    to,
    subject,
    text: lines.join("\n")
  });

  return true;
}

async function sendMail(message: { to: string; subject: string; text: string }): Promise<void> {
  const mailConfig = getMailConfig();
  if (!mailConfig) {
    throw new Error("SMTP is not configured");
  }

  await getTransporter(mailConfig).sendMail({
    from: mailConfig.from,
    ...message
  });
}

function getMailConfig(): MailConfig | null {
  const host = config.smtp.host;

  if (!host) {
    return null;
  }

  const user = config.smtp.user;
  const pass = config.smtp.pass;

  return {
    host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: user && pass ? { user, pass } : undefined,
    from: config.smtp.from || user || "Remote SIM Gateway <no-reply@localhost>",
    to: config.smsForward.to,
    subjectPrefix: config.smsForward.subjectPrefix
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
