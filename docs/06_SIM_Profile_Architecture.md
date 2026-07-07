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

Future table:

```sql
CREATE TABLE sim_profiles (
  profile_id TEXT PRIMARY KEY,
  subscription_id TEXT,
  icc_id TEXT,
  carrier_name TEXT,
  display_name TEXT,
  country TEXT,
  phone_number TEXT,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  is_default_sms INTEGER NOT NULL DEFAULT 0,
  is_default_voice INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT
);
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

Future Web UI should list Profiles:

```text
○ China Mobile
● Tello
○ Free Mobile
● Vodafone Egypt
○ MTN Nigeria
```

Do not display fixed `SIM1` or `SIM2` labels as the core model.
