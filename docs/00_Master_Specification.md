# Remote SIM Gateway - Master Specification V1.1

Remote SIM Gateway is a Remote Communication Platform.

It is not an SMS app and it is not remote-control software for Android phones. The platform manages communication identity, communication capability, communication state, and communication security.

## Architecture

```text
Browser(Web)
  |
Server(API)
  |
Android Gateway
  |
SIM / eSIM / GSM Network
```

Each layer has a strict responsibility boundary.

## Android Gateway

Android is the most stable layer and should rarely change.

Android owns capabilities only:

- Keep WebSocket online
- Receive SMS
- Send SMS
- Dial calls
- Answer calls
- Report device state
- Report SIM/Profile state

Android must not own business logic:

- Login
- Session
- SQLite
- SMTP
- Web UI workflow

## Server

Server is the platform brain and owns:

- Login
- Permissions
- Session
- SQLite
- SMTP
- API
- Audit logs
- Message state
- Profile management

Most future upgrades should happen in Server first, then Web, and only then Android if required.

## Web

Web is the only business entry point.

Keep the current UI style and the four core modules:

- Receive SMS
- Send SMS
- Answer calls
- Dial calls

Future modules such as SIM management, settings, logs, profiles, and statistics should follow the current UI style.

## Configuration

Runtime configuration is read from:

```text
/opt/remote-sim-gateway/.env
```

Configuration examples:

```text
ALLOWED_LOGIN_EMAIL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
SESSION_TIMEOUT
LOGIN_CODE_EXPIRE
MAX_LOGIN_ATTEMPTS
SMS_SEND_INTERVAL
PORT
SQLITE_PATH
```

Changing runtime settings should require only:

```bash
cd /opt/remote-sim-gateway
nano .env
pm2 restart remote-sim-gateway
```

Do not hard-code runtime configuration in GitHub.

## Security

- Login uses email or Telegram verification codes.
- No passwords.
- Verification code expiry: 5 minutes.
- Session timeout: 5 minutes.
- Single active session.
- All Web API routes must validate Session.
- Sensitive operations must write audit logs.

## SQLite

SQLite is the only database for now. It stores:

- SMS messages
- SIM Profiles
- Sessions
- Operation logs, when needed

The project may migrate to PostgreSQL later if scale requires it.

## SMS Notification Flow

When a new SMS arrives:

```text
SQLite save
  |
Email/Telegram forwarding, when configured
  |
Unread count update
  |
Browser WebSocket notification
  |
Browser Badge, when supported
  |
PWA Badge, when supported
  |
Browser title update
```

Entering the Receive SMS page marks messages as read.

Telegram Bot scope is limited to:

- Login verification code
- Incoming SMS forwarding
- SMS send command

Do not implement Telegram call answer, call dial, or hangup commands.

## SIM Profile Architecture

The system must be Profile-based, not SIM-slot-based.

Do not design around:

```text
SIM1
SIM2
```

Design around:

```text
Profile
```

Suggested Profile structure:

```text
profileId
deviceId
subscriptionId
iccId
carrierName
displayName
country
phoneNumber
slotIndex
isEnabled
isDefaultSms
isDefaultVoice
lastSeen
```

Reserved API:

```text
POST /api/sim/enable
POST /api/sim/disable
```

Android receives:

```text
enable_profile
disable_profile
```

If Android permissions allow the action, execute it. If permissions do not allow it, return `NOT_SUPPORTED`. Do not bypass Android system permissions.

## Roadmap

- M1: Receive SMS
- M2: Send SMS
- M3: Login, security, notification
- M4: Incoming call notification
- M5: Web dialing control
- M6: Web answering control
- M7: GSM to WebRTC audio bridge
- M8: eSIM Profile management
- M9: Multiple Android Gateways
