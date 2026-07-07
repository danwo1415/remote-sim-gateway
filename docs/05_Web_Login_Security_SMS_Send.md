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

All Web APIs under `/api` require a valid Session except `/api/auth/*`.

The session cookie is HTTP-only:

```text
rsg_session
```

## SMS Notification

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

## SMS Send API

```text
POST /api/sms/send
```

Body:

```json
{
  "to": "+1234567890",
  "text": "hello",
  "profileId": "optional-future-profile-id"
}
```

Server responsibilities:

- Validate Session
- Enforce `SMS_SEND_INTERVAL`
- Write audit log
- Forward `send_sms` command to the online Android Gateway

Android responsibilities:

- Send the actual SMS through the existing gateway capability

## Audit Log

Audit log path defaults to:

```text
server/logs/audit.log
```

Override with:

```bash
AUDIT_LOG_PATH="/opt/remote-sim-gateway/logs/audit.log"
```
