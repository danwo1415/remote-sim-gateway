# M2.2 SQLite SMS Web

M2.2 stores incoming SMS messages on the VPS with SQLite and shows real messages in the Web UI.

## Storage

The server creates this table automatically:

```sql
CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  phone_timestamp INTEGER,
  received_at TEXT NOT NULL,
  queued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

By default, the database file is:

```text
server/data/remote-sim-gateway.sqlite
```

Override it on the VPS with:

```bash
SQLITE_PATH="/opt/remote-sim-gateway/remote-sim-gateway.sqlite"
```

## API

```text
GET /api/sms
GET /api/sms?limit=50
```

Response:

```json
{
  "count": 1,
  "messages": [
    {
      "id": 1,
      "deviceId": "device-id",
      "from": "+10000000000",
      "body": "hello",
      "timestamp": 1783334856359,
      "receivedAt": "2026-07-06T10:47:36.359Z",
      "queuedAt": null,
      "createdAt": "2026-07-06T10:47:36.500Z"
    }
  ]
}
```

SMTP forwarding remains unchanged: incoming SMS is saved to SQLite and then forwarded by email when SMTP is configured.
