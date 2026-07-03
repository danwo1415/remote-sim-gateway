export type DeviceStatus = {
  online: boolean;
  deviceId: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
};

let status: DeviceStatus = {
  online: false,
  deviceId: null,
  connectedAt: null,
  lastSeenAt: null
};

export function markDeviceOnline(deviceId: string): DeviceStatus {
  const now = new Date().toISOString();
  status = {
    online: true,
    deviceId,
    connectedAt: now,
    lastSeenAt: now
  };
  return status;
}

export function markDeviceSeen(): DeviceStatus {
  if (!status.online) return status;
  status = {
    ...status,
    lastSeenAt: new Date().toISOString()
  };
  return status;
}

export function markDeviceOffline(): DeviceStatus {
  status = {
    ...status,
    online: false,
    lastSeenAt: new Date().toISOString()
  };
  return status;
}

export function getDeviceStatus(): DeviceStatus {
  return status;
}
