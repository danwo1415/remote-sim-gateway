# SIM Profile Architecture

Remote SIM Gateway must use Profile architecture, not SIM-slot architecture.

Do not model the system as:

```text
SIM1
SIM2
```

Model the system as:

```text
Profile
```

## Why

A future Android Gateway may contain many eSIM Profiles, while only a small number are enabled at the same time. The platform must manage communication identity, not physical slot labels.

## SQLite Table

Implemented table:

```sql
CREATE TABLE sim_profiles (
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
  last_seen TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Android reports current active SIM/eSIM Profiles after the device WebSocket connects:

```text
sim_profiles
```

Server upserts reported Profiles into SQLite and disables Profiles from the same device that are no longer reported as active.

If Android has not reported a complete Profile list yet, the Web still shows:

```text
默认 SIM
```

and sends:

```json
{
  "profileId": "default"
}
```

The Server may return:

```text
profile selection reserved / default SIM used
```

This means the Android Gateway sends through the Android system default SMS SIM.

## Profile APIs

```text
GET /api/sim/profiles
POST /api/sim/profiles
```

`GET /api/sim/profiles` returns the default SIM option plus enabled Profiles from SQLite.

`POST /api/sim/profiles` upserts Profile metadata for current/future Android reporting or operator-managed configuration.

## SMS Send Profile Selection

When Web selects a concrete Profile, Server sends:

```json
{
  "type": "send_sms",
  "payload": {
    "to": "+13022985056",
    "text": "hello",
    "profileId": "device-id:subscription:1",
    "subscriptionId": "1",
    "slotIndex": 0
  }
}
```

Android uses `SmsManager.getSmsManagerForSubscriptionId(subscriptionId)` to send through that active SIM/Profile.

If the selected Profile is no longer active on the phone, Android returns:

```text
sms_send_failed
subscription_not_available
```

## Reserved APIs

```text
POST /api/sim/enable
POST /api/sim/disable
```

Example payload:

```json
{
  "profileId": "profile-id"
}
```

## Reserved Android Commands

```text
enable_profile
disable_profile
```

If Android can perform the action with legal permissions, it should execute. If Android does not have required system permissions, it must return:

```text
NOT_SUPPORTED
```

Do not bypass Android permissions.

## Web SIM Management

Web UI should list Profiles:

```text
○ China Mobile
● Tello
○ Free Mobile
● Vodafone Egypt
○ MTN Nigeria
```

Do not display fixed `SIM1` or `SIM2` labels as the core model.
