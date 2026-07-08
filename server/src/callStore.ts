import { db } from "./db.js";

type CallPayload = {
  number?: unknown;
  startedAt?: unknown;
  answeredAt?: unknown;
  endedAt?: unknown;
  status?: unknown;
  ringDurationSeconds?: unknown;
  subscriptionId?: unknown;
  slotIndex?: unknown;
  carrierName?: unknown;
};

type CallRow = {
  id: number;
  device_id: string;
  phone_number: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  status: string;
  ring_duration_seconds: number | null;
  subscription_id: string | null;
  slot_index: number | null;
  carrier_name: string | null;
  created_at: string;
};

export type StoredCallLog = {
  id: number;
  deviceId: string;
  phoneNumber: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  status: string;
  ringDurationSeconds: number | null;
  subscriptionId: string | null;
  slotIndex: number | null;
  carrierName: string | null;
  createdAt: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    started_at TEXT NOT NULL,
    answered_at TEXT,
    ended_at TEXT,
    status TEXT NOT NULL,
    ring_duration_seconds INTEGER,
    subscription_id TEXT,
    slot_index INTEGER,
    carrier_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_call_logs_device_active
    ON call_logs(device_id, phone_number, ended_at);

  CREATE INDEX IF NOT EXISTS idx_call_logs_started_at
    ON call_logs(started_at DESC);
`);

const insertCallStatement = db.prepare(`
  INSERT INTO call_logs (
    device_id,
    phone_number,
    started_at,
    answered_at,
    ended_at,
    status,
    ring_duration_seconds,
    subscription_id,
    slot_index,
    carrier_name,
    created_at
  )
  VALUES (
    @deviceId,
    @phoneNumber,
    @startedAt,
    NULL,
    NULL,
    'ringing',
    NULL,
    @subscriptionId,
    @slotIndex,
    @carrierName,
    @createdAt
  )
`);

const getCallStatement = db.prepare(`
  SELECT
    id,
    device_id,
    phone_number,
    started_at,
    answered_at,
    ended_at,
    status,
    ring_duration_seconds,
    subscription_id,
    slot_index,
    carrier_name,
    created_at
  FROM call_logs
  WHERE id = @id
`);

const getActiveCallStatement = db.prepare(`
  SELECT
    id,
    device_id,
    phone_number,
    started_at,
    answered_at,
    ended_at,
    status,
    ring_duration_seconds,
    subscription_id,
    slot_index,
    carrier_name,
    created_at
  FROM call_logs
  WHERE device_id = @deviceId
    AND phone_number = @phoneNumber
    AND ended_at IS NULL
  ORDER BY id DESC
  LIMIT 1
`);

const updateAnsweredStatement = db.prepare(`
  UPDATE call_logs
  SET answered_at = @answeredAt,
      status = 'answered'
  WHERE id = @id
`);

const updateEndedStatement = db.prepare(`
  UPDATE call_logs
  SET ended_at = @endedAt,
      status = @status,
      ring_duration_seconds = @ringDurationSeconds
  WHERE id = @id
`);

export function saveIncomingCall(deviceId: string, payload: CallPayload): StoredCallLog {
  const createdAt = new Date().toISOString();
  const startedAt = normalizeDateString(payload.startedAt) || createdAt;
  const result = insertCallStatement.run({
    deviceId,
    phoneNumber: stringify(payload.number, "unknown"),
    startedAt,
    subscriptionId: normalizeOptionalString(payload.subscriptionId),
    slotIndex: normalizeOptionalInteger(payload.slotIndex),
    carrierName: normalizeOptionalString(payload.carrierName),
    createdAt
  });

  return loadCall(Number(result.lastInsertRowid));
}

export function markCallAnswered(deviceId: string, payload: CallPayload): StoredCallLog {
  const phoneNumber = stringify(payload.number, "unknown");
  const answeredAt = normalizeDateString(payload.answeredAt) || new Date().toISOString();
  const call = findOrCreateActiveCall(deviceId, phoneNumber, answeredAt);

  updateAnsweredStatement.run({
    id: call.id,
    answeredAt
  });

  return loadCall(call.id);
}

export function markCallEnded(deviceId: string, payload: CallPayload): StoredCallLog {
  const phoneNumber = stringify(payload.number, "unknown");
  const endedAt = normalizeDateString(payload.endedAt) || new Date().toISOString();
  const call = findOrCreateActiveCall(deviceId, phoneNumber, endedAt);
  const answeredAt = call.answeredAt;
  const status = normalizeCallStatus(payload.status, answeredAt);
  const ringDurationSeconds =
    normalizeOptionalInteger(payload.ringDurationSeconds) ?? calculateRingDurationSeconds(call.startedAt, answeredAt || endedAt);

  updateEndedStatement.run({
    id: call.id,
    endedAt,
    status,
    ringDurationSeconds
  });

  return loadCall(call.id);
}

function findOrCreateActiveCall(deviceId: string, phoneNumber: string, eventAt: string): StoredCallLog {
  const row = getActiveCallStatement.get({ deviceId, phoneNumber }) as CallRow | undefined;
  if (row) {
    return mapCallRow(row);
  }

  return saveIncomingCall(deviceId, {
    number: phoneNumber,
    startedAt: eventAt
  });
}

function loadCall(id: number): StoredCallLog {
  const row = getCallStatement.get({ id }) as CallRow | undefined;
  if (!row) {
    throw new Error("call_log_not_found");
  }

  return mapCallRow(row);
}

function mapCallRow(row: CallRow): StoredCallLog {
  return {
    id: row.id,
    deviceId: row.device_id,
    phoneNumber: row.phone_number,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    status: row.status,
    ringDurationSeconds: row.ring_duration_seconds,
    subscriptionId: row.subscription_id,
    slotIndex: row.slot_index,
    carrierName: row.carrier_name,
    createdAt: row.created_at
  };
}

function calculateRingDurationSeconds(startedAt: string, ringEndedAt: string): number {
  const started = new Date(startedAt).getTime();
  const ended = new Date(ringEndedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return 0;
  }

  return Math.max(0, Math.floor((ended - started) / 1000));
}

function normalizeCallStatus(value: unknown, answeredAt: string | null): "answered" | "missed" {
  const status = String(value || "").trim().toLowerCase();
  if (status === "answered" || status === "missed") {
    return status;
  }

  return answeredAt ? "answered" : "missed";
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(Math.trunc(value)).toISOString();
  }

  return null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function stringify(value: unknown, fallback: string): string {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return fallback;
  }

  return String(value).trim();
}
