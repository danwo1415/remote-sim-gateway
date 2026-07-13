import { db } from "./db.js";

type SmsSendLogRow = {
  id: number;
  source: string;
  actor: string;
  to_number: string;
  body: string;
  profile_id: string | null;
  profile_display_name: string | null;
  profile_phone_number: string | null;
  carrier_name: string | null;
  device_id: string | null;
  subscription_id: string | null;
  slot_index: number | null;
  status: string;
  error: string | null;
  created_at: string;
};

export type SmsSendLogStatus = "submitted" | "failed";

export type StoredSmsSendLog = {
  id: number;
  source: string;
  actor: string;
  to: string;
  text: string;
  profileId: string | null;
  profileDisplayName: string | null;
  profilePhoneNumber: string | null;
  carrierName: string | null;
  deviceId: string | null;
  subscriptionId: string | null;
  slotIndex: number | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type SmsSendLogInput = {
  source: string;
  actor: string;
  to: string;
  text: string;
  profileId?: string | null;
  profileDisplayName?: string | null;
  profilePhoneNumber?: string | null;
  carrierName?: string | null;
  deviceId?: string | null;
  subscriptionId?: string | number | null;
  slotIndex?: number | null;
  status: SmsSendLogStatus;
  error?: string | null;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sms_send_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    actor TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT NOT NULL,
    profile_id TEXT,
    profile_display_name TEXT,
    profile_phone_number TEXT,
    carrier_name TEXT,
    device_id TEXT,
    subscription_id TEXT,
    slot_index INTEGER,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sms_send_logs_created_at
    ON sms_send_logs(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_sms_send_logs_status
    ON sms_send_logs(status);
`);

const insertSmsSendLogStatement = db.prepare(`
  INSERT INTO sms_send_logs (
    source,
    actor,
    to_number,
    body,
    profile_id,
    profile_display_name,
    profile_phone_number,
    carrier_name,
    device_id,
    subscription_id,
    slot_index,
    status,
    error,
    created_at
  )
  VALUES (
    @source,
    @actor,
    @toNumber,
    @body,
    @profileId,
    @profileDisplayName,
    @profilePhoneNumber,
    @carrierName,
    @deviceId,
    @subscriptionId,
    @slotIndex,
    @status,
    @error,
    @createdAt
  )
`);

const listSmsSendLogsStatement = db.prepare(`
  SELECT
    id,
    source,
    actor,
    to_number,
    body,
    profile_id,
    profile_display_name,
    profile_phone_number,
    carrier_name,
    device_id,
    subscription_id,
    slot_index,
    status,
    error,
    created_at
  FROM sms_send_logs
  ORDER BY created_at DESC, id DESC
  LIMIT @limit
`);

const listSmsSendLogsByDeviceStatement = db.prepare(`
  SELECT
    id,
    source,
    actor,
    to_number,
    body,
    profile_id,
    profile_display_name,
    profile_phone_number,
    carrier_name,
    device_id,
    subscription_id,
    slot_index,
    status,
    error,
    created_at
  FROM sms_send_logs
  WHERE device_id = @deviceId
  ORDER BY created_at DESC, id DESC
  LIMIT @limit
`);

const getSmsSendLogStatement = db.prepare(`
  SELECT
    id,
    source,
    actor,
    to_number,
    body,
    profile_id,
    profile_display_name,
    profile_phone_number,
    carrier_name,
    device_id,
    subscription_id,
    slot_index,
    status,
    error,
    created_at
  FROM sms_send_logs
  WHERE id = @id
`);

export function saveSmsSendLog(input: SmsSendLogInput): StoredSmsSendLog {
  const createdAt = new Date().toISOString();
  const result = insertSmsSendLogStatement.run({
    source: input.source,
    actor: input.actor,
    toNumber: input.to,
    body: input.text,
    profileId: input.profileId || null,
    profileDisplayName: input.profileDisplayName || null,
    profilePhoneNumber: input.profilePhoneNumber || null,
    carrierName: input.carrierName || null,
    deviceId: input.deviceId || null,
    subscriptionId: input.subscriptionId === undefined || input.subscriptionId === null
      ? null
      : String(input.subscriptionId),
    slotIndex: input.slotIndex ?? null,
    status: input.status,
    error: input.error || null,
    createdAt
  });

  const row = getSmsSendLogStatement.get({ id: Number(result.lastInsertRowid) }) as SmsSendLogRow | undefined;
  if (!row) {
    throw new Error("Saved SMS send log could not be loaded from SQLite");
  }

  return mapSmsSendLogRow(row);
}

export function listSmsSendLogs(limit = 50, deviceId?: string | null): StoredSmsSendLog[] {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const normalizedDeviceId = normalizeOptionalString(deviceId);
  const rows = normalizedDeviceId
    ? listSmsSendLogsByDeviceStatement.all({ limit: boundedLimit, deviceId: normalizedDeviceId }) as SmsSendLogRow[]
    : listSmsSendLogsStatement.all({ limit: boundedLimit }) as SmsSendLogRow[];
  return rows.map(mapSmsSendLogRow);
}

export function parseSmsSendLogLimit(value: unknown): number {
  if (typeof value !== "string") {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return parsed;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function mapSmsSendLogRow(row: SmsSendLogRow): StoredSmsSendLog {
  return {
    id: row.id,
    source: row.source,
    actor: row.actor,
    to: row.to_number,
    text: row.body,
    profileId: row.profile_id,
    profileDisplayName: row.profile_display_name,
    profilePhoneNumber: row.profile_phone_number,
    carrierName: row.carrier_name,
    deviceId: row.device_id,
    subscriptionId: row.subscription_id,
    slotIndex: row.slot_index,
    status: row.status,
    error: row.error,
    createdAt: row.created_at
  };
}
