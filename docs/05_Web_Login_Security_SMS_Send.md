# Web Login, Security, Notification, and SMS Send

## Runtime Configuration

All runtime configuration is read from:

```text
/opt/remote-sim-gateway/.env
```

Example:

```bash
ALLOWED_LOGIN_EMAIL="user@example.com"

SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="smtp-user@example.com"
SMTP_PASS="smtp-password-or-app-password"
SMTP_FROM="Remote SIM Gateway <smtp-user@example.com>"

TELEGRAM_BOT_TOKEN="123456:bot-token"
TELEGRAM_CHAT_ID="123456789"

SMS_FORWARD_TO="target@example.com"

SESSION_TIMEOUT="300"
LOGIN_CODE_EXPIRE="300"
MAX_LOGIN_ATTEMPTS="5"
SMS_SEND_INTERVAL="60"
PORT="3000"
SQLITE_PATH="/opt/remote-sim-gateway/remote-sim-gateway.sqlite"
```

To change email, Telegram, SMTP, Session, SMS rate limit, port, or SQLite:

```bash
cd /opt/remote-sim-gateway
nano .env
pm2 restart remote-sim-gateway
```

Do not hard-code these values in GitHub.

## Auth APIs

```text
POST /api/auth/request-code
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/session
```

Login uses a 6-digit code delivered by email or Telegram.

Email delivery validates the email against:

```text
ALLOWED_LOGIN_EMAIL
```

Telegram delivery does not require an email. The trusted Telegram identity comes from:

```text
TELEGRAM_CHAT_ID
```

Telegram delivery requires:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

The Telegram bot sends the login code to the configured chat. The Web login then requires only that code while the Telegram channel is selected.

## Protected APIs

All Web APIs under `/api` require a valid Session except `/api/auth/*` and the Telegram Bot webhook:

```text
POST /api/telegram/webhook
```

The Telegram webhook does not use a Web Session, but it must reject SMS send commands from any chat other than:

```text
TELEGRAM_CHAT_ID
```

The session cookie is HTTP-only:

```text
rsg_session
```

## SMS Notification

Incoming SMS handling:

```text
Android incoming_sms
  |
SQLite save
  |
Email forwarding, when SMTP/SMS_FORWARD_TO are configured
  |
Telegram forwarding, when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured
  |
Browser WebSocket push
```

Telegram SMS forwarding format:

```text
From: +13022985056
Time: 2026-07-07 12:30:20

火鸡
```

Telegram forwarding failures are written to audit/server logs and must not block SQLite saving or Email forwarding.

The Web UI updates:

- Unread count
- Browser title
- Browser notification, when permission is granted
- Browser favicon badge
- PWA App Badge, when supported

Opening the Receive SMS module calls:

```text
POST /api/sms/mark-read
```

The Web uses realtime Browser WebSocket push:

```text
/ws/browser
```

The Browser WebSocket must validate the current Web Session cookie. A low-frequency 60-second SMS polling fallback may remain.

## SMS Send API

```text
POST /api/sms/send
```

Body:

```json
{
  "to": "+1234567890",
  "text": "hello",
  "profileId": "default"
}
```

Server responsibilities:

- Validate Session
- Enforce `SMS_SEND_INTERVAL`
- Write audit log
- Resolve `profileId`
- Forward `send_sms` command to the online Android Gateway:

```json
{
  "type": "send_sms",
  "payload": {
    "to": "+1234567890",
    "text": "hello",
    "profileId": "default",
    "subscriptionId": "optional",
    "slotIndex": 0
  }
}
```

Android responsibilities:

- Report current active SIM/eSIM Profiles to Server after `/ws/device` connects
- Send the actual SMS through the selected `subscriptionId` when a Profile is selected
- Send through the Android system default SMS SIM when `profileId` is `default`
- Return `sms_send_failed` with `subscription_not_available` if the selected Profile is no longer active on the phone

## Telegram Bot SMS Send

Telegram supports SMS sending only. It must not implement call answer, call dial, or hangup commands.

Supported commands:

```text
/send +13022985056 火鸡
```

or:

```text
/send +13022985056
火鸡
```

Rules:

- Only `TELEGRAM_CHAT_ID` may send commands.
- The command reuses the same Server SMS send path as Web.
- It enforces `SMS_SEND_INTERVAL`.
- It writes audit logs.
- It does not require a Web Session.
- It sends through the current online Android `/ws/device`.
- It uses the Android system default SMS SIM for now.

Telegram replies:

```text
✅ 短信发送指令已提交
❌ Android Gateway 当前离线，无法发送
❌ 格式错误，请使用：
/send +13022985056 短信内容
```

Configure the Telegram webhook after deployment:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR_DOMAIN/api/telegram/webhook"
```

## Audit Log

Audit log path defaults to:

```text
server/logs/audit.log
```

Override with:

```bash
AUDIT_LOG_PATH="/opt/remote-sim-gateway/logs/audit.log"
```
