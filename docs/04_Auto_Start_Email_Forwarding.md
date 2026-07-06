# Auto Start, Reconnect, and SMS Email Forwarding

## Android behavior

- After the first successful permission grant and VPS URL save, opening the app starts the gateway service automatically.
- After phone reboot, `BOOT_COMPLETED` starts the gateway service automatically when a real VPS WebSocket URL has already been saved.
- Incoming SMS messages are queued locally if the WebSocket is offline, then uploaded after reconnect.
- The foreground service uses `remoteMessaging` on Android 14+ so boot auto-start keeps working for message forwarding use cases.

Some Android vendors block background auto-start by default. If boot auto-start does not happen on a specific phone, allow this app in the vendor battery/auto-start settings.

## Android first-time setup

1. Install and open the APK.
2. Grant SMS, phone, and notification permissions.
3. Enter your VPS WebSocket URL, for example:

```text
wss://example.com/ws/device
```

4. Tap `Save & Start Gateway Service` once.
5. Copy the displayed `Device ID` and `Device Key` into the VPS environment variables.

## VPS email forwarding

Configure these environment variables on the VPS:

```bash
DEVICE_ID="device-id-from-app"
DEVICE_KEY="device-key-from-app"

SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="smtp-user@example.com"
SMTP_PASS="smtp-password-or-app-password"

SMS_FORWARD_TO="target@example.com"
SMS_FORWARD_FROM="Remote SIM Gateway <smtp-user@example.com>"
SMS_FORWARD_SUBJECT_PREFIX="[Remote SIM Gateway]"
```

Notes:

- `SMTP_SECURE=true` is usually used with port `465`.
- `SMTP_SECURE=false` is usually used with port `587` and STARTTLS.
- If `SMTP_HOST` or `SMS_FORWARD_TO` is missing, incoming SMS messages are still logged but email forwarding is disabled.
