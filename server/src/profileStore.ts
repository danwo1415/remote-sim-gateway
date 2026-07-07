import crypto from "node:crypto";
import { db } from "./db.js";

export const DEFAULT_PROFILE_ID = "default";

type SimProfileRow = {
  profile_id: string;
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
  last_seen: string | null;
  created_at: string;
  updated_at: string;
};

export type SimProfile = {
  profileId: string;
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
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SmsProfileSelection = {
  profileId: string;
  subscriptionId?: string;
  slotIndex?: number;
  note?: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS sim_profiles (
    profile_id TEXT PRIMARY KEY,
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
    last_seen TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sim_profiles_enabled
    ON sim_profiles(is_enabled);

  CREATE INDEX IF NOT EXISTS idx_sim_profiles_default_sms
    ON sim_profiles(is_default_sms);
`);

ensureColumn("sim_profiles", "slot_index", "INTEGER");
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
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  ORDER BY is_default_sms DESC, display_name ASC, profile_id ASC
`);

const listEnabledProfilesStatement = db.prepare(`
  SELECT
    profile_id,
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
    last_seen,
    created_at,
    updated_at
  FROM sim_profiles
  WHERE profile_id = @profileId
`);

const clearDefaultSmsStatement = db.prepare(`
  UPDATE sim_profiles
  SET is_default_sms = 0, updated_at = @updatedAt
  WHERE profile_id != @profileId
`);

const clearDefaultVoiceStatement = db.prepare(`
  UPDATE sim_profiles
  SET is_default_voice = 0, updated_at = @updatedAt
  WHERE profile_id != @profileId
`);

const upsertProfileStatement = db.prepare(`
  INSERT INTO sim_profiles (
    profile_id,
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
    last_seen,
    created_at,
    updated_at
  )
  VALUES (
    @profileId,
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
    @lastSeen,
    @createdAt,
    @updatedAt
  )
  ON CONFLICT(profile_id) DO UPDATE SET
    subscription_id = excluded.subscription_id,
    icc_id = excluded.icc_id,
    carrier_name = excluded.carrier_name,
    display_name = excluded.display_name,
    country = excluded.country,
    phone_number = excluded.phone_number,
    slot_index = excluded.slot_index,
    is_enabled = excluded.is_enabled,
    is_default_sms = excluded.is_default_sms,
    is_default_voice = excluded.is_default_voice,
    last_seen = excluded.last_seen,
    updated_at = excluded.updated_at
`);

export function listSimProfiles(): SimProfile[] {
  return (listProfilesStatement.all() as SimProfileRow[]).map(mapProfileRow);
}

export function listEnabledSimProfiles(): SimProfile[] {
  return (listEnabledProfilesStatement.all() as SimProfileRow[]).map(mapProfileRow);
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
  const isDefaultSms = normalizeBoolean(input.isDefaultSms, existing?.isDefaultSms ?? false);
  const isDefaultVoice = normalizeBoolean(input.isDefaultVoice, existing?.isDefaultVoice ?? false);

  if (isDefaultSms) {
    clearDefaultSmsStatement.run({ profileId, updatedAt: now });
  }

  if (isDefaultVoice) {
    clearDefaultVoiceStatement.run({ profileId, updatedAt: now });
  }

  upsertProfileStatement.run({
    profileId,
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
    lastSeen: normalizeOptionalString(input.lastSeen),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  const saved = getSimProfile(profileId);
  if (!saved) {
    throw new Error("profile_save_failed");
  }

  return saved;
}

export function resolveSmsProfile(profileIdInput: unknown): SmsProfileSelection {
  const profileId = normalizeOptionalString(profileIdInput) || DEFAULT_PROFILE_ID;

  if (profileId === DEFAULT_PROFILE_ID) {
    return {
      profileId: DEFAULT_PROFILE_ID,
      note: "profile selection reserved / default SIM used"
    };
  }

  const profile = getSimProfile(profileId);
  if (!profile) {
    throw new Error("profile_not_found");
  }

  if (!profile.isEnabled) {
    throw new Error("profile_disabled");
  }

  return {
    profileId: profile.profileId,
    ...(profile.subscriptionId ? { subscriptionId: profile.subscriptionId } : {}),
    ...(profile.slotIndex !== null ? { slotIndex: profile.slotIndex } : {})
  };
}

function mapProfileRow(row: SimProfileRow): SimProfile {
  return {
    profileId: row.profile_id,
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
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
