import crypto from "node:crypto";
import { db } from "./db.js";

export const DEFAULT_PROFILE_ID = "default";

type SimProfileRow = {
  profile_id: string;
  device_id: string | null;
  subscription_id: string | null;
  icc_id: string | null;
  carrier_name: string | null;
  display_name: string;
  country: string | null;
  phone_number: string | null;
  slot_index: number | null;
  is_enabled: number;
  is_default_sms: number;
  is_default_voice: number;
  has_signal: number | null;
  signal_state: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
};

export type SimProfile = {
  profileId: string;
  deviceId: string | null;
  subscriptionId: string | null;
  iccId: string | null;
  carrierName: string | null;
  displayName: string;
  country: string | null;
  phoneNumber: string | null;
  slotIndex: number | null;
  isEnabled: boolean;
  isDefaultSms: boolean;
  isDefaultVoice: boolean;
  hasSignal: boolean | null;
  signalState: string | null;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SmsProfileSelection = {
  profileId: string;
  subscriptionId?: number;
  slotIndex?: number;
  note?: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sim_profiles (
    profile_id TEXT PRIMARY KEY,
    device_id TEXT,
    subscription_id TEXT,
    icc_id TEXT,
    carrier_name TEXT,
    display_name TEXT NOT NULL,
    country TEXT,
    phone_number TEXT,
    slot_index INTEGER,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_default_sms INTEGER NOT NULL DEFAULT 0,
    is_default_voice INTEGER NOT NULL DEFAULT 0,
    has_signal INTEGER,
    signal_state TEXT,
    last_seen TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sim_profiles_enabled
    ON sim_profiles(is_enabled);

  CREATE INDEX IF NOT EXISTS idx_sim_profiles_default_sms
    ON sim_profiles(is_default_sms);

  CREATE INDEX IF NOT EXISTS idx_sim_profiles_device_id
    ON sim_profiles(device_id);
`);

ensureColumn("sim_profiles", "device_id", "TEXT");
ensureColumn("sim_profiles", "slot_index", "INTEGER");
ensureColumn("sim_profiles", "has_signal", "INTEGER");
ensureColumn("sim_profiles", "signal_state", "TEXT");
ensureColumn("sim_profiles", "created_at", "TEXT");
ensureColumn("sim_profiles", "updated_at", "TEXT");

db.exec(`
  UPDATE sim_profiles
  SET
    created_at = COALESCE(created_at, datetime('now')),
    updated_at = COALESCE(updated_at, datetime('now'))
  WHERE created_at IS NULL OR updated_at IS NULL;
`);

const listProfilesStatement = db.prepare(`
  SELECT
    profile_id,
    device_id,
    subscription_id,
    icc_id,
    carrier_name,
    display_name,
    country,
    phone_number,
    slot_index,
    is_enabled,
    is_default_sms,
    is_default_voice,
    has_signal,
    signal_state,
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  ORDER BY is_default_sms DESC, display_name ASC, profile_id ASC
`);

const listEnabledProfilesStatement = db.prepare(`
  SELECT
    profile_id,
    device_id,
    subscription_id,
    icc_id,
    carrier_name,
    display_name,
    country,
    phone_number,
    slot_index,
    is_enabled,
    is_default_sms,
    is_default_voice,
    has_signal,
    signal_state,
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  WHERE is_enabled = 1
  ORDER BY is_default_sms DESC, display_name ASC, profile_id ASC
`);

const getProfileStatement = db.prepare(`
  SELECT
    profile_id,
    device_id,
    subscription_id,
    icc_id,
    carrier_name,
    display_name,
    country,
    phone_number,
    slot_index,
    is_enabled,
    is_default_sms,
    is_default_voice,
    has_signal,
    signal_state,
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  WHERE profile_id = @profileId
`);

const listProfilesByDeviceStatement = db.prepare(`
  SELECT
    profile_id,
    device_id,
    subscription_id,
    icc_id,
    carrier_name,
    display_name,
    country,
    phone_number,
    slot_index,
    is_enabled,
    is_default_sms,
    is_default_voice,
    has_signal,
    signal_state,
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  WHERE device_id = @deviceId
`);

const clearDefaultSmsStatement = db.prepare(`
  UPDATE sim_profiles
  SET is_default_sms = 0, updated_at = @updatedAt
  WHERE profile_id != @profileId
    AND ((@deviceId IS NULL AND device_id IS NULL) OR device_id = @deviceId)
`);

const clearDefaultVoiceStatement = db.prepare(`
  UPDATE sim_profiles
  SET is_default_voice = 0, updated_at = @updatedAt
  WHERE profile_id != @profileId
    AND ((@deviceId IS NULL AND device_id IS NULL) OR device_id = @deviceId)
`);

const disableProfileStatement = db.prepare(`
  UPDATE sim_profiles
  SET is_enabled = 0, updated_at = @updatedAt
  WHERE profile_id = @profileId
`);

const upsertProfileStatement = db.prepare(`
  INSERT INTO sim_profiles (
    profile_id,
    device_id,
    subscription_id,
    icc_id,
    carrier_name,
    display_name,
    country,
    phone_number,
    slot_index,
    is_enabled,
    is_default_sms,
    is_default_voice,
    has_signal,
    signal_state,
    last_seen,
    created_at,
    updated_at
  )
  VALUES (
    @profileId,
    @deviceId,
    @subscriptionId,
    @iccId,
    @carrierName,
    @displayName,
    @country,
    @phoneNumber,
    @slotIndex,
    @isEnabled,
    @isDefaultSms,
    @isDefaultVoice,
    @hasSignal,
    @signalState,
    @lastSeen,
    @createdAt,
    @updatedAt
  )
  ON CONFLICT(profile_id) DO UPDATE SET
    device_id = excluded.device_id,
    subscription_id = excluded.subscription_id,
    icc_id = excluded.icc_id,
    carrier_name = excluded.carrier_name,
    display_name = excluded.display_name,
    country = excluded.country,
    phone_number = COALESCE(excluded.phone_number, sim_profiles.phone_number),
    slot_index = excluded.slot_index,
    is_enabled = excluded.is_enabled,
    is_default_sms = excluded.is_default_sms,
    is_default_voice = excluded.is_default_voice,
    has_signal = excluded.has_signal,
    signal_state = excluded.signal_state,
    last_seen = excluded.last_seen,
    updated_at = excluded.updated_at
`);

export function listSimProfiles(): SimProfile[] {
  return (listProfilesStatement.all() as SimProfileRow[]).map(mapProfileRow);
}

export function listEnabledSimProfiles(): SimProfile[] {
  const profiles = (listEnabledProfilesStatement.all() as SimProfileRow[]).map(mapProfileRow);
  return dedupeEnabledProfiles(profiles);
}

export function getSimProfile(profileId: string): SimProfile | null {
  const row = getProfileStatement.get({ profileId }) as SimProfileRow | undefined;
  return row ? mapProfileRow(row) : null;
}

export function upsertSimProfile(input: Record<string, unknown>): SimProfile {
  const now = new Date().toISOString();
  const profileId = normalizeOptionalString(input.profileId) || crypto.randomUUID();
  const displayName = normalizeOptionalString(input.displayName);

  if (!displayName) {
    throw new Error("display_name_required");
  }

  const existing = getSimProfile(profileId);
  const deviceId = normalizeOptionalString(input.deviceId);
  const isDefaultSms = normalizeBoolean(input.isDefaultSms, existing?.isDefaultSms ?? false);
  const isDefaultVoice = normalizeBoolean(input.isDefaultVoice, existing?.isDefaultVoice ?? false);

  if (isDefaultSms) {
    clearDefaultSmsStatement.run({ profileId, deviceId, updatedAt: now });
  }

  if (isDefaultVoice) {
    clearDefaultVoiceStatement.run({ profileId, deviceId, updatedAt: now });
  }

  upsertProfileStatement.run({
    profileId,
    deviceId,
    subscriptionId: normalizeOptionalString(input.subscriptionId),
    iccId: normalizeOptionalString(input.iccId),
    carrierName: normalizeOptionalString(input.carrierName),
    displayName,
    country: normalizeOptionalString(input.country),
    phoneNumber: normalizeOptionalString(input.phoneNumber),
    slotIndex: normalizeOptionalInteger(input.slotIndex),
    isEnabled: normalizeBoolean(input.isEnabled, existing?.isEnabled ?? true) ? 1 : 0,
    isDefaultSms: isDefaultSms ? 1 : 0,
    isDefaultVoice: isDefaultVoice ? 1 : 0,
    hasSignal: normalizeOptionalBoolean(input.hasSignal),
    signalState: normalizeOptionalString(input.signalState),
    lastSeen: normalizeOptionalTimestampString(input.lastSeen),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  const saved = getSimProfile(profileId);
  if (!saved) {
    throw new Error("profile_save_failed");
  }

  return saved;
}

export function syncDeviceSimProfiles(deviceId: string, value: unknown): SimProfile[] {
  const profiles = Array.isArray(value) ? value : [];
  const savedProfiles: SimProfile[] = [];
  const activeProfileIds = new Set<string>();

  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") {
      continue;
    }

    const saved = upsertSimProfile({
      ...(profile as Record<string, unknown>),
      deviceId,
      isEnabled: true
    });
    activeProfileIds.add(saved.profileId);
    savedProfiles.push(saved);
  }

  const now = new Date().toISOString();
  const existingRows = listProfilesByDeviceStatement.all({ deviceId }) as SimProfileRow[];

  for (const row of existingRows) {
    if (!activeProfileIds.has(row.profile_id)) {
      disableProfileStatement.run({ profileId: row.profile_id, updatedAt: now });
    }
  }

  return savedProfiles;
}

export function resolveSmsProfile(profileIdInput: unknown): SmsProfileSelection {
  const profileId = normalizeOptionalString(profileIdInput);

  if (!profileId || profileId === DEFAULT_PROFILE_ID) {
    throw new Error("profile_required");
  }

  const profile = getSimProfile(profileId);
  if (!profile) {
    throw new Error("profile_not_found");
  }

  if (!profile.isEnabled) {
    throw new Error("profile_disabled");
  }

  const subscriptionId = normalizeOptionalInteger(profile.subscriptionId);

  return {
    profileId: profile.profileId,
    ...(subscriptionId !== null ? { subscriptionId } : {}),
    ...(profile.slotIndex !== null ? { slotIndex: profile.slotIndex } : {})
  };
}

export function findDeviceSimProfile(
  deviceId: string,
  input: { profileId?: unknown; subscriptionId?: unknown; slotIndex?: unknown }
): SimProfile | null {
  const profileId = normalizeOptionalString(input.profileId);
  const subscriptionId = normalizeOptionalString(input.subscriptionId);
  const slotIndex = normalizeOptionalInteger(input.slotIndex);
  const profiles = (listProfilesByDeviceStatement.all({ deviceId }) as SimProfileRow[]).map(mapProfileRow);

  if (profileId) {
    const byProfile = profiles.find((profile) => profile.profileId === profileId);
    if (byProfile) {
      return byProfile;
    }
  }

  if (subscriptionId) {
    const bySubscription = profiles.find((profile) => profile.subscriptionId === subscriptionId);
    if (bySubscription) {
      return bySubscription;
    }
  }

  if (slotIndex !== null) {
    const bySlot = profiles.find((profile) => profile.slotIndex === slotIndex);
    if (bySlot) {
      return bySlot;
    }
  }

  return null;
}

function mapProfileRow(row: SimProfileRow): SimProfile {
  return {
    profileId: row.profile_id,
    deviceId: row.device_id,
    subscriptionId: row.subscription_id,
    iccId: row.icc_id,
    carrierName: row.carrier_name,
    displayName: row.display_name,
    country: row.country,
    phoneNumber: row.phone_number,
    slotIndex: row.slot_index,
    isEnabled: row.is_enabled === 1,
    isDefaultSms: row.is_default_sms === 1,
    isDefaultVoice: row.is_default_voice === 1,
    hasSignal: row.has_signal === null ? null : row.has_signal === 1,
    signalState: row.signal_state,
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function dedupeEnabledProfiles(profiles: SimProfile[]): SimProfile[] {
  const selected = new Map<string, SimProfile>();

  for (const profile of profiles) {
    if (!profile.deviceId) {
      continue;
    }

    const key = profileDeduplicationKey(profile);
    const existing = selected.get(key);

    if (!existing || shouldPreferProfile(profile, existing)) {
      selected.set(key, profile);
    }
  }

  return Array.from(selected.values())
    .sort((a, b) => {
      if (a.isDefaultSms !== b.isDefaultSms) {
        return a.isDefaultSms ? -1 : 1;
      }

      return `${a.displayName}:${a.profileId}`.localeCompare(`${b.displayName}:${b.profileId}`);
    });
}

function profileDeduplicationKey(profile: SimProfile): string {
  if (profile.iccId) {
    return `icc:${profile.iccId}`;
  }

  if (profile.phoneNumber) {
    return `phone:${profile.phoneNumber}`;
  }

  if (profile.subscriptionId) {
    return `subscription:${profile.subscriptionId}`;
  }

  const carrierName = profile.carrierName || "";
  if (carrierName && profile.slotIndex !== null) {
    return `slot:${profile.slotIndex}:${carrierName}`;
  }

  return `profile:${profile.profileId}`;
}

function shouldPreferProfile(candidate: SimProfile, existing: SimProfile): boolean {
  const candidateScore = profileFreshnessScore(candidate);
  const existingScore = profileFreshnessScore(existing);

  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }

  return new Date(candidate.updatedAt).getTime() > new Date(existing.updatedAt).getTime();
}

function profileFreshnessScore(profile: SimProfile): number {
  let score = 0;

  if (profile.deviceId) score += 8;
  if (profile.lastSeen) score += 4;
  if (profile.isDefaultSms) score += 2;
  if (profile.hasSignal) score += 1;

  return score;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeOptionalTimestampString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(Math.trunc(value)).toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(Math.trunc(parsed)).toISOString();
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }

    return value.trim();
  }

  return null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeOptionalBoolean(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return 1;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return 0;
  }

  return null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
