# M1 - Device Online

## Goal

Android App connects to VPS through WebSocket and Web UI shows device online status.

## Scope

This milestone does not include SMS or phone operations.

## Files

Replace:

- `android/app/src/main/java/com/example/remotesimgateway/MainActivity.kt`
- `android/app/src/main/java/com/example/remotesimgateway/GatewayService.kt`
- `server/src/index.ts`
- `web/index.html`

Add:

- `docs/milestones/M1_Device_Online.md`

## Test

1. GitHub Actions:
   - Build Android APK = green
   - Build Server = green

2. Deploy server to VPS.

3. Open web page:
   - Device should show Offline first.

4. Install APK.

5. Copy Device ID and Device Key from Android App.

6. Configure VPS:
   - `DEVICE_ID`
   - `DEVICE_KEY`

7. In Android App, set:
   - `wss://YOUR_DOMAIN/ws/device`

8. Tap:
   - Start Gateway Service

9. Web page should show:
   - Device Online
