import { db } from "./db.js";

type SmsPayload = {
  from?: unknown;
  to?: unknown;
  toNumber?: unknown;
  simNumber?: unknown;
  body?: unknown;
  timestamp?: unknown;
  queuedAt?: unknown;
};

type SmsRow = {
  id: number;
  device_id: string;
  sender: string;
  recipient_number: string | null;
  body: string;
  phone_timestamp: number | null;
  received_at: string;
  queued_at: string | null;
  read_at: string | null;
  created_at: string;
};

export type StoredSmsMessage = {
  id: number;
  deviceId: string;
  from: string;
  to: string | null;
  body: string;
  timestamp: number | null;
  receivedAt: string;
  queuedAt: string | null;
  readAt: string | null;
  unread: boolean;
  createdAt: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient_number TEXT,
    body TEXT NOT NULL,
    phone_timestamp INTEGER,
    received_at TEXT NOT NULL,
    queued_at TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sms_messages_received_at
    ON sms_messages(received_at DESC);

  CREATE INDEX IF NOT EXISTS idx_sms_messages_device_id
    ON sms_messages(device_id);
`);

ensureColumn("sms_messages", "read_at", "TEXT");
ensureColumn("sms_messages", "recipient_number", "TEXT");

const insertSmsStatement = db.prepare(`
  INSERT INTO sms_messages (
    device_id,
    sender,
    recipient_number,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    read_at,
    created_at
  )
  VALUES (
    @deviceId,
    @sender,
    @recipientNumber,
    @body,
    @phoneTimestamp,
    @receivedAt,
    @queuedAt,
    NULL,
    @createdAt
  )
`);

const listSmsStatement = db.prepare(`
  SELECT
    id,
    device_id,
    sender,
    recipient_number,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    read_at,
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
    recipient_number,
    body,
    phone_timestamp,
    received_at,
    queued_at,
    read_at,
    created_at
  FROM sms_messages
  WHERE id = @id
`);

const unreadCountStatement = db.prepare(`
  SELECT COUNT(*) AS count
  FROM sms_messages
  WHERE read_at IS NULL
`);

const markAllReadStatement = db.prepare(`
  UPDATE sms_messages
  SET read_at = @readAt
  WHERE read_at IS NULL
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
    recipientNumber: optionalString(payload.to) ?? optionalString(payload.toNumber) ?? optionalString(payload.simNumber),
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

export function getUnreadSmsCount(): number {
  const row = unreadCountStatement.get() as { count: number };
  return row.count;
}

export function markAllSmsRead(): number {
  const result = markAllReadStatement.run({ readAt: new Date().toISOString() });
  return result.changes;
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
    to: row.recipient_number,
    body: row.body,
    timestamp: row.phone_timestamp,
    receivedAt: row.received_at,
    queuedAt: row.queued_at,
    readAt: row.read_at,
    unread: row.read_at === null,
    createdAt: row.created_at
  };
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function stringify(value: unknown, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  return String(value);
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
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
