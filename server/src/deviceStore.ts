import { db } from "./db.js";

export type StoredDevice = {
  deviceId: string;
  deviceModel: string | null;
  displayName: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DeviceRow = {
  device_id: string;
  device_model: string | null;
  display_name: string;
  online: number;
  connected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_model TEXT,
    display_name TEXT NOT NULL,
    online INTEGER NOT NULL DEFAULT 0,
    connected_at TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_devices_online
    ON devices(online);
`);

const upsertOnlineDeviceStatement = db.prepare(`
  INSERT INTO devices (
    device_id,
    device_model,
    display_name,
    online,
    connected_at,
    last_seen_at,
    created_at,
    updated_at
  )
  VALUES (
    @deviceId,
    @deviceModel,
    @displayName,
    1,
    @now,
    @now,
    @now,
    @now
  )
  ON CONFLICT(device_id) DO UPDATE SET
    device_model = COALESCE(excluded.device_model, devices.device_model),
    display_name = excluded.display_name,
    online = 1,
    connected_at = excluded.connected_at,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
`);

const markSeenStatement = db.prepare(`
  UPDATE devices
  SET last_seen_at = @now, updated_at = @now
  WHERE device_id = @deviceId
`);

const markOfflineStatement = db.prepare(`
  UPDATE devices
  SET online = 0, last_seen_at = @now, updated_at = @now
  WHERE device_id = @deviceId
`);

const listDevicesStatement = db.prepare(`
  SELECT
    device_id,
    device_model,
    display_name,
    online,
    connected_at,
    last_seen_at,
    created_at,
    updated_at
  FROM devices
  ORDER BY online DESC, last_seen_at DESC, display_name ASC
`);

const getDeviceStatement = db.prepare(`
  SELECT
    device_id,
    device_model,
    display_name,
    online,
    connected_at,
    last_seen_at,
    created_at,
    updated_at
  FROM devices
  WHERE device_id = @deviceId
`);

export function markStoredDeviceOnline(deviceId: string, deviceModel?: unknown): StoredDevice {
  const now = new Date().toISOString();
  const model = normalizeOptionalString(deviceModel);
  upsertOnlineDeviceStatement.run({
    deviceId,
    deviceModel: model,
    displayName: buildDeviceDisplayName(model, deviceId),
    now
  });
  return getStoredDevice(deviceId) as StoredDevice;
}

export function markStoredDeviceSeen(deviceId: string): void {
  markSeenStatement.run({ deviceId, now: new Date().toISOString() });
}

export function markStoredDeviceOffline(deviceId: string): void {
  markOfflineStatement.run({ deviceId, now: new Date().toISOString() });
}

export function listStoredDevices(): StoredDevice[] {
  return (listDevicesStatement.all() as DeviceRow[]).map(mapDeviceRow);
}

export function getStoredDevice(deviceId: string): StoredDevice | null {
  const row = getDeviceStatement.get({ deviceId }) as DeviceRow | undefined;
  return row ? mapDeviceRow(row) : null;
}

export function getDeviceDisplayName(deviceId: string | null | undefined): string {
  if (!deviceId) {
    return "-";
  }

  return getStoredDevice(deviceId)?.displayName || buildDeviceDisplayName(null, deviceId);
}

function mapDeviceRow(row: DeviceRow): StoredDevice {
  return {
    deviceId: row.device_id,
    deviceModel: row.device_model,
    displayName: row.display_name,
    online: row.online === 1,
    connectedAt: row.connected_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildDeviceDisplayName(deviceModel: string | null, deviceId: string): string {
  const suffix = deviceId.slice(-4) || "0000";
  return `${deviceModel || "Android"}-${suffix}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}
