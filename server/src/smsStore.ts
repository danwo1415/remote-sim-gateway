import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "remote-sim-gateway.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  queued_at INTEGER,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at
ON sms_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_sms_messages_read_at
ON sms_messages(read_at);
`);

export type SmsMessage = {
  id: number;
  deviceId: string;
  from: string;
  body: string;
  timestamp: number;
  receivedAt: string;
  queuedAt: number | null;
  createdAt: string;
  readAt: string | null;
};

type SmsRow = {
  id: number;
  device_id: string;
  sender: string;
  body: string;
  timestamp: number;
  received_at: string;
  queued_at: number | null;
  created_at: string;
  read_at: string | null;
};

function mapRow(row: SmsRow): SmsMessage {
  return {
    id: row.id,
    deviceId: row.device_id,
    from: row.sender,
    body: row.body,
    timestamp: row.timestamp,
    receivedAt: row.received_at,
    queuedAt: row.queued_at,
    createdAt: row.created_at,
    readAt: row.read_at
  };
}

export function saveIncomingSms(input: {
  deviceId: string;
  from: string;
  body: string;
  timestamp: number;
  queuedAt?: number | null;
}): SmsMessage {
  const receivedAt = new Date(input.timestamp).toISOString();
  const createdAt = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO sms_messages (
      device_id,
      sender,
      body,
      timestamp,
      received_at,
      queued_at,
      created_at,
      read_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    input.deviceId,
    input.from,
    input.body,
    input.timestamp,
    receivedAt,
    input.queuedAt ?? null,
    createdAt
  );

  const row = db.prepare(`
    SELECT * FROM sms_messages WHERE id = ?
  `).get(result.lastInsertRowid) as SmsRow;

  return mapRow(row);
}

export function listSmsMessages(limit = 50): SmsMessage[] {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const rows = db.prepare(`
    SELECT * FROM sms_messages
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit) as SmsRow[];

  return rows.map(mapRow);
}

export function countSmsMessages(): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM sms_messages
  `).get() as { count: number };

  return row.count;
}

export function countUnreadSms(): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM sms_messages
    WHERE read_at IS NULL
  `).get() as { count: number };

  return row.count;
}

export function markAllSmsRead(): void {
  db.prepare(`
    UPDATE sms_messages
    SET read_at = ?
    WHERE read_at IS NULL
  `).run(new Date().toISOString());
}
