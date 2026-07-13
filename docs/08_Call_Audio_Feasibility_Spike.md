# Call Audio Feasibility Spike

This is a minimal investigation for bridging cellular call audio between one
Android Gateway and one browser page through WebRTC. It is not a product
implementation and does not change SMS, login, SQLite, Profile, Telegram, or the
existing web UI.

## Scope

- One Android Gateway.
- One active SIM/Profile.
- One cellular call.
- One browser page.
- One WebRTC audio path, only if the platform permits it.

## Current Project Baseline

- Android `compileSdk`: 35.
- Android `minSdk`: 26.
- Android `targetSdk`: 35.
- Current Android manifest includes phone/SMS/network/service permissions, but
  does not declare `RECORD_AUDIO`, `CAPTURE_AUDIO_OUTPUT`, or
  `MODIFY_AUDIO_ROUTING`.
- Current Android code has phone state reporting and basic phone control helpers.
  It does not contain `AudioRecord`, `MediaRecorder`, `VOICE_CALL`,
  `VOICE_DOWNLINK`, `VOICE_UPLINK`, `InCallService`, `ConnectionService`, or a
  WebRTC stack.

## Android Public API Findings

Android exposes `MediaRecorder.AudioSource.VOICE_CALL`,
`VOICE_DOWNLINK`, and `VOICE_UPLINK`, but the platform documentation states that
capturing from these sources requires `Manifest.permission.CAPTURE_AUDIO_OUTPUT`.
The same documentation states that this permission is reserved for system
components and is not available to third-party applications.

Source:
https://developer.android.com/reference/android/media/MediaRecorder.AudioSource

Android 10 AudioPlaybackCapture is not a cellular call bridge. It requires
`RECORD_AUDIO`, user-approved `MediaProjection`, and capturable playback from
another app. The producing audio must use `USAGE_MEDIA`, `USAGE_GAME`, or
`USAGE_UNKNOWN`, and allow capture by policy. Cellular telephony downlink audio
is not exposed as normal capturable app media.

Source:
https://developer.android.com/media/platform/av-capture#capture-audio-playback

`InCallService` is for apps that manage calls and provide the in-call UI, usually
as the default phone app. It does not provide a public raw PCM API for capturing
cellular downlink audio or injecting arbitrary browser microphone PCM into the
cellular uplink.

Source:
https://developer.android.com/reference/android/telecom/InCallService

`CallAudioState` exposes routes such as earpiece, Bluetooth, speakerphone, wired
headset, and streaming route. These APIs route call audio; they do not provide a
normal third-party app with bidirectional raw cellular call audio.

Source:
https://developer.android.com/reference/android/telecom/CallAudioState

## Feasibility Decision

Ordinary self-signed APK: not feasible for the required success criteria.

Reason:

1. The app cannot capture cellular call downlink audio through public APIs
   without `CAPTURE_AUDIO_OUTPUT`, which is system-only.
2. The app cannot inject browser microphone PCM into the cellular call uplink
   through a public third-party Android API.
3. InCallService/default dialer APIs can manage calls and routes, but they do not
   grant raw bidirectional cellular audio bridging.
4. Playing browser audio through the phone speaker and relying on the phone
   microphone would be an acoustic loopback workaround, not a valid bridge.

## Failure Classification

- A. Cannot obtain cellular downlink audio.
- B. Cannot inject cellular uplink audio.
- D. Can route/play audio, but not inject it into the call.
- E. Requires system-level permission or privilege.
- G. Device vendor and Android version restrictions may also apply.

## Prototype Decision

No WebRTC prototype was added in this branch. The requested success criteria are
blocked by Android's public permission/API model before application code can
prove a valid non-acoustic bridge.

## What Would Be Needed To Continue

One of the following controlled paths would be required before a real prototype
is worth building:

- System-signed or privileged Android app with access to protected audio capture
  permissions and routing APIs.
- Root or custom ROM with explicit telephony audio routing/capture support.
- Device/vendor private telephony audio APIs.
- External cellular gateway hardware or a SIP/VoIP provider path instead of
  attempting to bridge the phone's native cellular audio from a normal APK.
