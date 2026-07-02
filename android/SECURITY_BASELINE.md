# Remote SIM Gateway Security Baseline V1.0

## Authentication

- Email verification code login only.
- No password login.
- Login email must enable 2FA.
- Only whitelisted email addresses can log in.
- Verification code expires in 5 minutes.
- Verification code can be attempted at most 5 times.
- Same email can request one code per 60 seconds.

## Session

- Web session expires in 5 minutes.
- If an active SIM call is connected, session is extended until the call ends.
- After the call ends, session expires immediately.
- Browser refresh, tab close, browser close, or logout invalidates the session.
- One active web session per account only.

## VPS

- Only port 443 should be open.
- SSH key login only.
- SSH password login must be disabled.

## Android Device

- Android app generates Device ID and Device Key on first install.
- VPS accepts only pre-bound Device ID / Device Key.
- Android app communicates only through HTTPS/WSS.

## Rate Limits

- Send SMS: max 1 message per minute.
- Dial call: max 1 call per minute.
- Answer call: no rate limit.
- View SMS / call records: no rate limit.

## Data Storage

Stored on user's own VPS:

- SMS
- Call records
- Call recordings

## Audit Log

Audit logs include:

- Login
- Logout
- Failed login
- Verification code sent
- Send SMS
- Dial call
- Answer call
- Android online/offline

Audit log retention:

- 30 days
- Automatically deleted after retention period

Audit logs must not store:

- SMS body
- Call recording content
- Verification code
- Session token
- Device Key
