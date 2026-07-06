import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

type SmsPayload = {
  from?: unknown;
  body?: unknown;
  timestamp?: unknown;
  queuedAt?: unknown;
};

type SmsRow = {
  id: number;
  device_id: string;
  sender: string;
  body: string;
  phone_timestamp: number | null;
  received_at: string;
  queued_at: string | null;
  created_at: string;
};

export type StoredSmsMessage = {
  id: number;
  deviceId: string;
  from: string;
  body: string;
  timestamp: number | null;
  receivedAt: string;
  queuedAt: string | null;
  createdAt: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDir = path.resolve(__dirname, "../data");
const dbPath = process.env.SQLITE_PATH || path.join(defaultDataDir, "remote-sim-gateway.sqlite");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    body TEXT NOT NULL,
    phone_timestamp INTEGER,
    received_at TEXT NOT NULL,
    queued_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sms_messages_received_at
    ON sms_messages(received_at DESC);

  CREATE INDEX IF NOT EXISTS idx_sms_messages_device_id
    ON sms_messages(device_id);
`);

const insertSmsStatement = db.prepare(`
  INSERT INTO sms_messages (
    device_id,
    sender,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    created_at
  )
  VALUES (
    @deviceId,
    @sender,
    @body,
    @phoneTimestamp,
    @receivedAt,
    @queuedAt,
    @createdAt
  )
`);

const listSmsStatement = db.prepare(`
  SELECT
    id,
    device_id,
    sender,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    created_at
  FROM sms_messages
  ORDER BY received_at DESC, id DESC
  LIMIT @limit
`);

const getSmsStatement = db.prepare(`
  SELECT
    id,
    device_id,
    sender,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    created_at
  FROM sms_messages
  WHERE id = @id
`);

export function saveIncomingSms(deviceId: string, payload: SmsPayload): StoredSmsMessage {
  const phoneTimestamp = normalizeTimestamp(payload.timestamp);
  const queuedTimestamp = normalizeTimestamp(payload.queuedAt);
  const createdAt = new Date().toISOString();
  const receivedAt = phoneTimestamp ? new Date(phoneTimestamp).toISOString() : createdAt;
  const queuedAt = queuedTimestamp ? new Date(queuedTimestamp).toISOString() : null;

  const result = insertSmsStatement.run({
    deviceId,
    sender: stringify(payload.from, "unknown"),
    body: stringify(payload.body, ""),
    phoneTimestamp,
    receivedAt,
    queuedAt,
    createdAt
  });

  const row = getSmsStatement.get({ id: Number(result.lastInsertRowid) }) as SmsRow | undefined;
  if (!row) {
    throw new Error("Saved SMS could not be loaded from SQLite");
  }

  return mapSmsRow(row);
}

export function listSmsMessages(limit = 100): StoredSmsMessage[] {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const rows = listSmsStatement.all({ limit: boundedLimit }) as SmsRow[];
  return rows.map(mapSmsRow);
}

export function parseSmsLimit(value: unknown): number {
  if (typeof value !== "string") {
    return 100;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 100;
  }

  return parsed;
}

function mapSmsRow(row: SmsRow): StoredSmsMessage {
  return {
    id: row.id,
    deviceId: row.device_id,
    from: row.sender,
    body: row.body,
    timestamp: row.phone_timestamp,
    receivedAt: row.received_at,
    queuedAt: row.queued_at,
    createdAt: row.created_at
  };
}

function stringify(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return null;
}
