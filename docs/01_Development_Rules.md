# Remote SIM Gateway - Development Rules

## Priority

For new features, modify layers in this order:

1. Server
2. Web
3. Android, only when required

Android APK should stay stable and should not receive business logic.

## Required Boundaries

- Browser(Web): business entry point and UI.
- Server(API): login, session, SQLite, SMTP, permissions, audit, message state.
- Android Gateway: communication capability execution.
- SIM / eSIM / GSM Network: carrier network.

## UI Rules

- Do not redesign the current UI.
- Do not remove the four core modules.
- Keep Receive SMS, Send SMS, Answer Calls, and Dial Calls visible.
- New panels must follow the current card/grid style.

## Configuration Rules

- Use `/opt/remote-sim-gateway/.env` for runtime settings.
- Do not commit `.env`.
- Do not commit SMTP passwords or secrets.
- Changing email, SMTP, Session, SQLite, or port configuration must not require GitHub changes.

## Security Rules

- Login uses email verification code only.
- No passwords.
- All Web APIs must validate Session, except `/api/auth/*` and `/health`.
- Sensitive operations must write audit logs.

## Database Rules

- SQLite is the only database for now.
- Prefer migrations that preserve existing data.
- Do not delete existing tables or fields without an explicit migration plan.

## SIM Rules

- Build around Profile, not SIM1/SIM2.
- Reserve profile-oriented APIs and command payloads.
- Do not bypass Android system permissions.

## Git Rules

- Develop on feature branches.
- GitHub Actions must pass before merging to `main`.

## Required Delivery Report

Every development task must report:

1. Modified files
2. Whether APK reinstall is required
3. Whether `.env` changes are required
4. Whether Server redeploy is required
5. New APIs
6. New SQLite fields
7. New docs
8. Deployment steps
9. Verification steps
