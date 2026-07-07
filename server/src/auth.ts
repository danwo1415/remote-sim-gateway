import "./config.js";

export function isDeviceAllowed(deviceId: string | undefined, deviceKey: string | undefined): boolean {
  const expectedDeviceId = process.env.DEVICE_ID;
  const expectedDeviceKey = process.env.DEVICE_KEY;

  if (!expectedDeviceId || !expectedDeviceKey) {
    // M1.1 development fallback:
    // If env vars are not configured, reject empty credentials but allow any non-empty pair.
    return Boolean(deviceId && deviceKey);
  }

  return deviceId === expectedDeviceId && deviceKey === expectedDeviceKey;
}
