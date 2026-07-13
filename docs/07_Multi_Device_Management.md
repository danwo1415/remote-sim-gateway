# 07 Multi Device Management

## Goal

Remote SIM Gateway supports multiple Android Gateway devices.

The platform still keeps the four-layer architecture:

Browser(Web) -> Server(API) -> Android Gateway -> SIM / eSIM / GSM Network

Android only reports capability and state. Server owns device state, routing, SQLite, Telegram, Web API, and audit behavior.

## Device Name

Server names devices as:

```text
<Device Model>-<last 4 chars of deviceId>
```

Examples:

```text
Pixel 8-a13f
SM-S9210-98ab
```

New APK versions report `X-Device-Model` during WebSocket connection and also include `deviceModel` in the `device_online` event.

Old APK versions remain compatible, but the device name falls back to:

```text
Android-<last 4 chars of deviceId>
```

## SQLite Table

New table:

```sql
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
```

SMS messages also include `profile_id`:

```sql
ALTER TABLE sms_messages ADD COLUMN profile_id TEXT;
```

Existing `sms_messages.device_id` is kept and used for per-device filtering.

## Server Routing

Server keeps Android WebSockets in:

```ts
Map<deviceId, WebSocket>
```

Sending SMS must specify a target `deviceId`. Server no longer sends SMS to an arbitrary online Android Gateway.

Command sent to Android:

```json
{
  "type": "send_sms",
  "payload": {
    "to": "+13022985056",
    "text": "message",
    "profileId": "device-id:subscription:6",
    "subscriptionId": 6,
    "slotIndex": 0
  }
}
```

## APIs

New API:

```text
GET /api/devices
```

Returns all known Android Gateway devices, including:

- deviceId
- deviceModel
- displayName
- online
- connectedAt
- lastSeenAt

Updated APIs:

```text
GET /api/sim/profiles?deviceId=<deviceId>
GET /api/sms?deviceId=<deviceId>&limit=50
GET /api/sms/sent?deviceId=<deviceId>&limit=50
POST /api/sms/mark-read
POST /api/sms/send
```

`POST /api/sms/send` now requires:

```json
{
  "deviceId": "...",
  "profileId": "...",
  "to": "+13022985056",
  "text": "message"
}
```

## Web Flow

After login:

1. Web shows Device selection first.
2. User selects one Android Gateway device.
3. Web enters the existing four modules:
   - Receive SMS
   - Send SMS
   - Answer Calls
   - Make Calls
4. SMS list, send history, and SIM/Profile list are filtered by selected device.
5. User can switch device from the status card.

The four-module UI style remains unchanged.

## Telegram Flow

Telegram SMS command keeps the formatted input:

```text
/send sms / +13022985056 / message
```

Flow:

1. Bot asks user to choose Device.
2. After Device selection, Bot asks user to choose SIM/Profile for that Device.
3. Server sends the SMS command only to the selected Android Gateway.
4. Bot replies with result including Device and Profile.

Additional commands:

```text
/devices
/profiles
```

Telegram notifications for incoming SMS and calls include:

```text
Device: <Device Model>-<deviceId last 4 chars>
```

## Optional Multi-Device Auth

For production multi-device allowlist, configure:

```env
DEVICE_KEYS="deviceId1=deviceKey1;deviceId2=deviceKey2"
```

If `DEVICE_KEYS` is not set, existing `DEVICE_ID` + `DEVICE_KEY` behavior is preserved.

If neither is set, development fallback remains: any non-empty `deviceId` and `deviceKey` are accepted.

## Deployment

Server:

```bash
cd /opt/remote-sim-gateway
git pull origin codex/web-login-security-sms-send
cd server
npm install
npm run build
pm2 restart remote-sim-gateway
```

Android:

Install the latest APK if you want Device Model based names. Without the new APK, multi-device still works but display names may use `Android-xxxx`.

## Verification

1. Open two Android Gateway devices.
2. Confirm Web shows both devices after login.
3. Select Device A and verify its SIM/Profile list.
4. Send SMS from Web through Device A.
5. Send Telegram command:

```text
/send sms / +13022985056 / message
```

6. Confirm Bot asks for Device first, then SIM/Profile.
7. Receive SMS on each phone and confirm Telegram notification includes `Device:`.
8. Disconnect one Android Gateway and confirm Web shows it offline with updated last seen time.