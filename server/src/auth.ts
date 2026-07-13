import "./config.js";

export function isDeviceAllowed(deviceId: string | undefined, deviceKey: string | undefined): boolean {
  const configuredDeviceKeys = parseDeviceKeys(process.env.DEVICE_KEYS);
  if (configuredDeviceKeys.size > 0) {
    return Boolean(deviceId && deviceKey && configuredDeviceKeys.get(deviceId) === deviceKey);
  }

  const expectedDeviceId = process.env.DEVICE_ID;
  const expectedDeviceKey = process.env.DEVICE_KEY;

  if (!expectedDeviceId || !expectedDeviceKey) {
    // M1.1 development fallback:
    // If env vars are not configured, reject empty credentials but allow any non-empty pair.
    return Boolean(deviceId && deviceKey);
  }

  return deviceId === expectedDeviceId && deviceKey === expectedDeviceKey;
}

function parseDeviceKeys(value: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!value) {
    return result;
  }

  for (const item of value.split(/[;,\n]+/)) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const separator = pair.includes("=") ? "=" : ":";
    const index = pair.indexOf(separator);
    if (index <= 0) {
      continue;
    }

    const deviceId = pair.slice(0, index).trim();
    const deviceKey = pair.slice(index + 1).trim();
    if (deviceId && deviceKey) {
      result.set(deviceId, deviceKey);
    }
  }

  return result;
}