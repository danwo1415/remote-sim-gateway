import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { config } from "./config.js";
import {
  getDeviceDisplayName,
  listStoredDevices,
  markStoredDeviceOffline,
  markStoredDeviceOnline,
  markStoredDeviceSeen
} from "./deviceStore.js";
import { isDeviceAllowed } from "./auth.js";
import { forwardIncomingSmsEmail } from "./mailer.js";
import { audit } from "./audit.js";
import {
  markCallAnswered,
  markCallEnded,
  saveIncomingCall
} from "./callStore.js";
import {
  DEFAULT_PROFILE_ID,
  type SimProfile,
  findDeviceSimProfile,
  getSimProfile,
  listEnabledSimProfiles,
  listEnabledSimProfilesByDevice,
  resolveSmsProfileForDevice,
  syncDeviceSimProfiles,
  upsertSimProfile
} from "./profileStore.js";
import {
  getUnreadSmsCount,
  listSmsMessages,
  markAllSmsRead,
  parseSmsLimit,
  saveIncomingSms
} from "./smsStore.js";
import {
  listSmsSendLogs,
  parseSmsSendLogLimit,
  saveSmsSendLog
} from "./sentSmsStore.js";
import {
  forwardCallResultTelegram,
  forwardIncomingSmsTelegram,
  sendTelegramMessage
} from "./telegram.js";
import {
  getResponseSession,
  getRequestSession,
  login,
  logout,
  requestLoginCode,
  requireSession,
  sessionStatus
} from "./webAuth.js";

const port = config.port;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../../web");

const app = express();
const activeDeviceSockets = new Map<string, WebSocket>();
const activeBrowserSockets = new Set<WebSocket>();
const lastSmsSendByActor = new Map<string, number>();
const pendingTelegramSmsSelections = new Map<string, PendingTelegramSmsSelection>();
const pendingSmsSendAcks = new Map<string, PendingSmsSendAck>();
const SMS_SEND_ACK_TIMEOUT_MS = 15_000;
let telegramPollingOffset = 0;
let telegramPollingStarted = false;

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "remote-sim-gateway-server",
    version: "0.1.0",
    time: new Date().toISOString()
  });
});

app.post("/api/auth/request-code", (req, res) => {
  void requestLoginCode(req, res);
});

app.post("/api/auth/login", (req, res) => {
  login(req, res);
});

app.post("/api/auth/logout", (req, res) => {
  logout(req, res);
});

app.get("/api/auth/session", (req, res) => {
  sessionStatus(req, res);
});

app.post("/api/telegram/webhook", (req, res) => {
  void handleTelegramWebhook(req, res);
});

app.use("/api", requireSession);

app.get("/api/device/status", (_req, res) => {
  const devices = listStoredDevices();
  const device = devices.find((item) => item.online) || devices[0] || null;
  res.json(device ? {
    online: device.online,
    deviceId: device.deviceId,
    displayName: device.displayName,
    connectedAt: device.connectedAt,
    lastSeenAt: device.lastSeenAt
  } : {
    online: false,
    deviceId: null,
    displayName: null,
    connectedAt: null,
    lastSeenAt: null
  });
});

app.get("/api/devices", (_req, res) => {
  res.json({ devices: listStoredDevices() });
});

app.get("/api/sim/profiles", (req, res) => {
  const deviceId = normalizeRequestText(req.query.deviceId);
  const refreshResult = deviceId
    ? sendDeviceCommand("refresh_sim_profiles", {}, deviceId)
    : sendDeviceCommand("refresh_sim_profiles", {});
  if (!refreshResult.ok) {
    console.warn("[sim] refresh_sim_profiles not sent", { deviceId, reason: refreshResult.error });
  }

  const profiles = deviceId ? listEnabledSimProfilesByDevice(deviceId) : listEnabledSimProfiles();
  console.log("[sim] profiles requested", {
    count: profiles.length,
    deviceId,
    deviceRefreshSent: refreshResult.ok
  });

  res.json({
    defaultProfile: null,
    deviceId,
    profiles
  });
});

app.post("/api/sim/profiles", (req, res) => {
  const session = getResponseSession(res);

  try {
    const profile = upsertSimProfile(req.body || {});
    audit("sim_profile_upsert", {
      email: session.email,
      profileId: profile.profileId,
      displayName: profile.displayName
    });
    res.json({ ok: true, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "profile_save_failed";
    audit("sim_profile_upsert_failed", { email: session.email, error: message });
    res.status(400).json({ error: message });
  }
});

app.get("/api/sms", (req, res) => {
  const deviceId = normalizeRequestText(req.query.deviceId);
  const messages = listSmsMessages(parseSmsLimit(req.query.limit), deviceId);
  res.json({
    count: messages.length,
    unreadCount: getUnreadSmsCount(deviceId),
    deviceId,
    messages
  });
});

app.get("/api/sms/sent", (req, res) => {
  const deviceId = normalizeRequestText(req.query.deviceId);
  const messages = listSmsSendLogs(parseSmsSendLogLimit(req.query.limit), deviceId);
  res.json({
    count: messages.length,
    deviceId,
    messages
  });
});

app.post("/api/sms/mark-read", (req, res) => {
  const session = getResponseSession(res);
  const deviceId = normalizeRequestText(req.body?.deviceId || req.query.deviceId);
  const changed = markAllSmsRead(deviceId);
  audit("sms_mark_read", { email: session.email, deviceId, count: changed });
  res.json({
    ok: true,
    changed,
    deviceId,
    unreadCount: getUnreadSmsCount(deviceId)
  });
});

app.post("/api/sms/send", (req, res) => {
  void handleWebSmsSend(req, res);
});

async function handleWebSmsSend(req: Request, res: Response): Promise<void> {
  const session = getResponseSession(res);
  const to = String(req.body?.to || "").trim();
  const text = String(req.body?.text || "").trim();
  const deviceId = normalizeRequestText(req.body?.deviceId);
  const profileId = String(req.body?.profileId || "").trim();

  console.log("[sms] send request received", {
    source: "web",
    actor: session.email,
    deviceId,
    to,
    profileId,
    textLength: text.length
  });

  if (!to || !text) {
    res.status(400).json({ error: "to_and_text_required" });
    return;
  }

  if (!deviceId) {
    res.status(400).json({ error: "device_required" });
    return;
  }

  if (!profileId || profileId === DEFAULT_PROFILE_ID) {
    res.status(400).json({ error: "profile_required" });
    return;
  }

  const result = await submitSmsSend({
    actorKey: `web:${session.email}`,
    actorLabel: session.email,
    source: "web",
    deviceId,
    to,
    text,
    profileId
  });

  if (!result.ok) {
    console.warn("[sms] send request failed", {
      source: "web",
      actor: session.email,
      deviceId,
      to,
      profileId,
      error: result.error
    });
    res.status(result.status).json({
      error: result.error,
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
    });
    return;
  }

  res.json({
    ok: true,
    deviceId: result.deviceId,
    deviceName: getDeviceDisplayName(result.deviceId),
    profileId: result.profileId,
    note: result.note,
    status: "submitted"
  });
}

app.use(express.static(webRoot));

const server = http.createServer(app);

const deviceWss = new WebSocketServer({ noServer: true });
const browserWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/ws/browser") {
    const session = getRequestSession(req, false);

    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    browserWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      browserWss.emit("connection", ws, req, session.email);
    });
    return;
  }

  if (url.pathname !== "/ws/device") {
    socket.destroy();
    return;
  }

  const deviceId = req.headers["x-device-id"];
  const deviceKey = req.headers["x-device-key"];
  const deviceModel = req.headers["x-device-model"];

  const normalizedDeviceId = Array.isArray(deviceId) ? deviceId[0] : deviceId;
  const normalizedDeviceKey = Array.isArray(deviceKey) ? deviceKey[0] : deviceKey;
  const normalizedDeviceModel = Array.isArray(deviceModel) ? deviceModel[0] : deviceModel;

  if (!isDeviceAllowed(normalizedDeviceId, normalizedDeviceKey)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  deviceWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    deviceWss.emit("connection", ws, req, normalizedDeviceId, normalizedDeviceModel);
  });
});

browserWss.on("connection", (ws: WebSocket, _req: http.IncomingMessage, email: string) => {
  activeBrowserSockets.add(ws);
  console.log(`[browser] online: ${email}`);

  ws.on("close", () => {
    activeBrowserSockets.delete(ws);
    console.log(`[browser] offline: ${email}`);
  });

  ws.on("error", (error: Error) => {
    console.error("[browser] websocket error", error);
  });

  ws.send(JSON.stringify({
    type: "browser_hello",
    payload: {
      unreadCount: getUnreadSmsCount(),
      time: new Date().toISOString()
    }
  }));
});

deviceWss.on("connection", (ws: WebSocket, _req: http.IncomingMessage, deviceId: string, deviceModel?: string) => {
  const device = markStoredDeviceOnline(deviceId, deviceModel);
  activeDeviceSockets.set(deviceId, ws);
  console.log(`[device] online: ${device.displayName} (${deviceId})`);
  broadcastBrowserEvent("devices_updated", { devices: listStoredDevices() });

  ws.on("message", (raw: RawData) => {
    markStoredDeviceSeen(deviceId);

    const text = raw.toString();
    console.log(`[device] message: ${text}`);

    try {
      const json = JSON.parse(text);
      const type = json.type;
      const payload = json.payload || {};

      if (type === "device_online") {
        const updatedDevice = markStoredDeviceOnline(deviceId, payload.deviceModel || payload.model || deviceModel);
        audit("device_online", { deviceId, displayName: updatedDevice.displayName });
        broadcastBrowserEvent("devices_updated", { devices: listStoredDevices() });
      }

      if (type === "sim_profiles") {
        const profiles = syncDeviceSimProfiles(deviceId, payload.profiles);
        audit("sim_profiles_sync", {
          deviceId,
          count: profiles.length,
          error: payload.error
        });

        broadcastBrowserEvent("sim_profiles_updated", {
          deviceId,
          profiles: listEnabledSimProfilesByDevice(deviceId)
        });
      }

      if (type === "sms_send_submitted") {
        console.log("[sms] sms_send_submitted received", {
          deviceId,
          commandId: payload.commandId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          usedDefaultSim: payload.usedDefaultSim
        });
        audit("android_sms_send_submitted", {
          deviceId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          usedDefaultSim: payload.usedDefaultSim
        });
        resolveSmsSendAck(payload.commandId, {
          ok: true,
          commandId: String(payload.commandId || ""),
          deviceId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          usedDefaultSim: payload.usedDefaultSim
        });
      }

      if (type === "sms_send_failed") {
        console.warn("[sms] sms_send_failed received", {
          deviceId,
          commandId: payload.commandId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          slotIndex: payload.slotIndex,
          error: payload.error
        });
        audit("android_sms_send_failed", {
          deviceId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          slotIndex: payload.slotIndex,
          error: payload.error
        });
        resolveSmsSendAck(payload.commandId, {
          ok: false,
          commandId: String(payload.commandId || ""),
          deviceId,
          to: payload.to,
          profileId: payload.profileId,
          subscriptionId: payload.subscriptionId,
          error: String(payload.error || "android_sms_send_failed")
        });
      }

      if (type === "incoming_call") {
        const callPayload = enrichCallPayloadWithSimProfile(deviceId, payload);
        const call = saveIncomingCall(deviceId, callPayload);
        audit("call_incoming", {
          deviceId,
          callId: call.id,
          phoneNumber: call.phoneNumber,
          subscriptionId: call.subscriptionId,
          slotIndex: call.slotIndex,
          carrierName: call.carrierName,
          simNumber: call.simNumber
        });
      }

      if (type === "call_answered") {
        const call = markCallAnswered(deviceId, enrichCallPayloadWithSimProfile(deviceId, payload));
        audit("call_answered", {
          deviceId,
          callId: call.id,
          phoneNumber: call.phoneNumber,
          answeredAt: call.answeredAt
        });
      }

      if (type === "call_ended") {
        const call = markCallEnded(deviceId, enrichCallPayloadWithSimProfile(deviceId, payload));
        audit("call_ended", {
          deviceId,
          callId: call.id,
          phoneNumber: call.phoneNumber,
          status: call.status,
          ringDurationSeconds: call.ringDurationSeconds,
          simNumber: call.simNumber
        });

        void forwardCallResultTelegram(call)
          .then((sent) => {
            if (sent) {
              console.log("[telegram] call result forwarded");
            }
          })
          .catch((error: unknown) => {
            audit("telegram_call_forward_failed", {
              callId: call.id,
              stage: "ended",
              error: getErrorMessage(error)
            });
            console.error("[telegram] failed to forward call result", error);
          });
      }

      if (type === "incoming_sms") {
        const smsPayload = enrichSmsPayloadWithSimProfile(deviceId, payload);
        const savedSms = saveIncomingSms(deviceId, smsPayload);
        const unreadCount = getUnreadSmsCount(deviceId);

        console.log("========== INCOMING SMS ==========");
        console.log(`Saved ID: ${savedSms.id}`);
        console.log(`From: ${smsPayload.from || "unknown"}`);
        console.log(`To: ${savedSms.to || ""}`);
        console.log(`Timestamp: ${smsPayload.timestamp || ""}`);
        console.log(`Body: ${smsPayload.body || ""}`);
        console.log("==================================");

        void forwardIncomingSmsEmail(deviceId, smsPayload)
          .then((sent) => {
            if (sent) {
              console.log("[mail] incoming SMS forwarded");
            }
          })
          .catch((error: unknown) => {
            console.error("[mail] failed to forward incoming SMS", error);
          });

        void forwardIncomingSmsTelegram(savedSms)
          .then((sent) => {
            if (sent) {
              console.log("[telegram] incoming SMS forwarded");
            }
          })
          .catch((error: unknown) => {
            audit("telegram_sms_forward_failed", {
              smsId: savedSms.id,
              error: getErrorMessage(error)
            });
            console.error("[telegram] failed to forward incoming SMS", error);
          });

        broadcastBrowserEvent("sms_received", {
          message: savedSms,
          unreadCount
        });
      }
    } catch (error) {
      console.error("[device] failed to parse message", error);
    }
  });

  ws.on("close", () => {
    if (activeDeviceSockets.get(deviceId) === ws) {
      activeDeviceSockets.delete(deviceId);
      markStoredDeviceOffline(deviceId);
      console.log(`[device] offline: ${deviceId}`);
      broadcastBrowserEvent("devices_updated", { devices: listStoredDevices() });
      return;
    }
    console.log(`[device] stale socket closed: ${deviceId}`);
  });

  ws.on("error", (error: Error) => {
    console.error("[device] websocket error", error);
  });

  ws.send(JSON.stringify({
    type: "server_hello",
    payload: {
      accepted: true,
      time: new Date().toISOString()
    }
  }));
});

server.listen(port, () => {
  console.log(`Remote SIM Gateway server listening on port ${port}`);
  startTelegramPolling();
});

type SmsSendSource = "web" | "telegram";

type SubmitSmsSendInput = {
  actorKey: string;
  actorLabel: string;
  source: SmsSendSource;
  deviceId: string;
  to: string;
  text: string;
  profileId: string;
};

type SubmitSmsSendResult =
  | { ok: true; deviceId: string; profileId: string; note?: string }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

type SmsSendAck = {
  ok: boolean;
  commandId: string;
  deviceId: string;
  to?: unknown;
  profileId?: unknown;
  subscriptionId?: unknown;
  usedDefaultSim?: unknown;
  error?: string;
};

type PendingSmsSendAck = {
  timeout: ReturnType<typeof setTimeout>;
  resolve: (ack: SmsSendAck) => void;
};

type TelegramDeviceOption = {
  deviceId: string;
  displayName: string;
  online: boolean;
  lastSeenAt: string | null;
};

type TelegramProfileOption = {
  deviceId: string;
  deviceName: string;
  profileId: string;
  displayName: string;
  carrierName: string | null;
  phoneNumber: string | null;
  isEnabled: boolean;
  isDefaultSms: boolean;
};

type PendingTelegramSmsSelection = {
  stage: "device" | "profile";
  to: string;
  text: string;
  createdAt: number;
  devices?: TelegramDeviceOption[];
  device?: TelegramDeviceOption;
  profiles?: TelegramProfileOption[];
};

async function submitSmsSend(input: SubmitSmsSendInput): Promise<SubmitSmsSendResult> {
  let profile: ReturnType<typeof resolveSmsProfileForDevice>;
  let profileDetails: SimProfile | null = null;

  try {
    profile = resolveSmsProfileForDevice(input.deviceId, input.profileId);
    profileDetails = getSimProfile(profile.profileId);
  } catch (error) {
    const message = getErrorMessage(error);
    audit("sms_send_failed", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: input.profileId,
      reason: message
    });
    recordSmsSendHistory(input, input.profileId || null, null, {
      status: "failed",
      error: message
    });
    return { ok: false, status: 400, error: message };
  }

  const now = Date.now();
  const lastSentAt = lastSmsSendByActor.get(input.actorKey) || 0;
  const retryAfterMs = config.smsSendIntervalMs - (now - lastSentAt);

  if (retryAfterMs > 0) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    audit("sms_send_rate_limited", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: profile.profileId,
      retryAfterSeconds
    });
    recordSmsSendHistory(input, profile.profileId, profileDetails, {
      status: "failed",
      error: "sms_send_rate_limited",
      subscriptionId: profile.subscriptionId,
      slotIndex: profile.slotIndex ?? null
    });
    return {
      ok: false,
      status: 429,
      error: "sms_send_rate_limited",
      retryAfterSeconds
    };
  }

  const commandId = crypto.randomUUID();
  const commandPayload = {
    commandId,
    to: input.to,
    text: input.text,
    profileId: profile.profileId,
    ...(profile.subscriptionId ? { subscriptionId: profile.subscriptionId } : {}),
    ...(profile.slotIndex !== undefined ? { slotIndex: profile.slotIndex } : {})
  };

  const ackPromise = waitForSmsSendAck(commandId);
  const result = sendDeviceCommand("send_sms", commandPayload, input.deviceId);

  if (!result.ok) {
    cancelSmsSendAck(commandId);
    audit("sms_send_failed", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: profile.profileId,
      reason: result.error
    });
    recordSmsSendHistory(input, profile.profileId, profileDetails, {
      status: "failed",
      error: result.error,
      subscriptionId: profile.subscriptionId,
      slotIndex: profile.slotIndex ?? null
    });
    return result;
  }

  lastSmsSendByActor.set(input.actorKey, now);
  const ack = await ackPromise;

  if (!ack.ok) {
    const error = ack.error || "android_sms_send_failed";
    audit("sms_send_failed", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: profile.profileId,
      deviceId: result.deviceId,
      reason: error
    });
    recordSmsSendHistory(input, profile.profileId, profileDetails, {
      status: "failed",
      error,
      deviceId: result.deviceId,
      subscriptionId: firstText(ack.subscriptionId, profile.subscriptionId),
      slotIndex: profile.slotIndex ?? null
    });
    return {
      ok: false,
      status: error === "sms_send_ack_timeout" ? 504 : 502,
      error
    };
  }

  audit("sms_send_submitted", {
    source: input.source,
    actor: input.actorLabel,
    to: input.to,
    profileId: profile.profileId,
    deviceId: result.deviceId,
    note: profile.note,
    commandId
  });
  recordSmsSendHistory(input, profile.profileId, profileDetails, {
    status: "submitted",
    deviceId: result.deviceId,
    subscriptionId: firstText(ack.subscriptionId, profile.subscriptionId),
    slotIndex: profile.slotIndex ?? null
  });

  return {
    ok: true,
    deviceId: result.deviceId,
    profileId: profile.profileId,
    note: profile.note
  };
}

function recordSmsSendHistory(
  input: SubmitSmsSendInput,
  profileId: string | null,
  profile: SimProfile | null,
  details: {
    status: "submitted" | "failed";
    error?: string | null;
    deviceId?: string | null;
    subscriptionId?: string | number | null;
    slotIndex?: number | null;
  }
): void {
  try {
    saveSmsSendLog({
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      text: input.text,
      profileId,
      profileDisplayName: profile?.displayName ?? null,
      profilePhoneNumber: profile?.phoneNumber ?? null,
      carrierName: profile?.carrierName ?? null,
      deviceId: details.deviceId ?? input.deviceId,
      subscriptionId: details.subscriptionId ?? profile?.subscriptionId ?? null,
      slotIndex: details.slotIndex ?? profile?.slotIndex ?? null,
      status: details.status,
      error: details.error ?? null
    });
  } catch (error) {
    console.error("[sms] failed to record send history", error);
  }
}

function waitForSmsSendAck(commandId: string): Promise<SmsSendAck> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingSmsSendAcks.delete(commandId);
      resolve({
        ok: false,
        commandId,
        deviceId: "",
        error: "sms_send_ack_timeout"
      });
    }, SMS_SEND_ACK_TIMEOUT_MS);

    pendingSmsSendAcks.set(commandId, {
      timeout,
      resolve
    });
  });
}

function resolveSmsSendAck(commandIdInput: unknown, ack: SmsSendAck): void {
  const commandId = String(commandIdInput || "");
  if (!commandId) {
    return;
  }

  const pending = pendingSmsSendAcks.get(commandId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingSmsSendAcks.delete(commandId);
  pending.resolve(ack);
}

function cancelSmsSendAck(commandId: string): void {
  const pending = pendingSmsSendAcks.get(commandId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingSmsSendAcks.delete(commandId);
}

async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  await processTelegramMessage(req.body?.message || req.body?.edited_message, "webhook");
  res.json({ ok: true });
}

type TelegramMessageLike = {
  chat?: { id?: unknown };
  text?: unknown;
};

type TelegramUpdateLike = {
  update_id?: unknown;
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
};

async function processTelegramMessage(message: TelegramMessageLike | undefined, source: "webhook" | "polling"): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.warn("[telegram] command ignored: bot token or chat id is not configured");
    return;
  }

  const chatId = message?.chat?.id === undefined ? "" : String(message.chat.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const normalizedText = text.toLowerCase();
  const isKnownCommand = normalizedText.startsWith("/send")
    || normalizedText.startsWith("/profiles")
    || normalizedText.startsWith("/devices");

  if (isKnownCommand || isPendingTelegramSelection(chatId, text)) {
    console.log("[telegram] command received", {
      source,
      chatId,
      text: text.slice(0, 80)
    });
  }

  if (!isKnownCommand && !isPendingTelegramSelection(chatId, text)) {
    return;
  }

  if (chatId !== config.telegram.chatId) {
    console.warn("[telegram] command rejected: chat id is not allowed", { source, chatId });
    audit("telegram_sms_send_rejected", { chatId, source, reason: "chat_not_allowed" });
    return;
  }

  if (isPendingTelegramSelection(chatId, text)) {
    await handleTelegramSelection(chatId, text);
    return;
  }

  if (normalizedText.startsWith("/devices")) {
    const devices = buildTelegramDeviceOptions();
    await sendTelegramReply(devices.length > 0 ? formatTelegramDevicesList(devices) : formatNoTelegramDevices());
    return;
  }

  if (normalizedText.startsWith("/profiles")) {
    const profiles = buildTelegramProfileOptions();
    await sendTelegramReply(profiles.length > 0 ? formatTelegramProfilesList(profiles) : formatNoTelegramProfiles());
    return;
  }

  const parsed = parseTelegramSendCommand(text);
  if (!parsed.ok) {
    audit("telegram_sms_send_failed", { chatId, source, reason: parsed.error });
    await sendTelegramReply(formatTelegramSmsUsageError());
    return;
  }

  if (parsed.profileId) {
    const profileDetails = getSimProfile(parsed.profileId);
    if (!profileDetails?.deviceId) {
      await sendTelegramReply("Send failed: profile not found. Use /profiles to view available profiles.");
      return;
    }

    await submitTelegramSms(chatId, parsed.to, parsed.text, profileDetails.deviceId, parsed.profileId, false);
    return;
  }

  const devices = buildTelegramDeviceOptions();
  if (devices.length === 0) {
    await sendTelegramReply(formatNoTelegramDevices());
    return;
  }

  pendingTelegramSmsSelections.set(chatId, {
    stage: "device",
    to: parsed.to,
    text: parsed.text,
    createdAt: Date.now(),
    devices
  });
  await sendTelegramReply(formatTelegramDeviceSelectionPrompt(devices));
}
function startTelegramPolling(): void {
  if (telegramPollingStarted || !config.telegram.botToken || !config.telegram.chatId) {
    return;
  }

  telegramPollingStarted = true;
  void resetTelegramWebhookForPolling()
    .catch((error: unknown) => {
      audit("telegram_polling_webhook_reset_failed", { error: getErrorMessage(error) });
      console.error("[telegram] failed to reset webhook for polling", error);
    })
    .finally(() => {
      scheduleTelegramPolling(1000);
    });
}

function scheduleTelegramPolling(delayMs: number): void {
  const timer = setTimeout(() => {
    void pollTelegramUpdates();
  }, delayMs);
  timer.unref?.();
}

async function resetTelegramWebhookForPolling(): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/deleteWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: false })
  });

  if (!response.ok) {
    throw new Error(`Telegram deleteWebhook failed: ${response.status}`);
  }

  console.log("[telegram] polling enabled");
}

async function pollTelegramUpdates(): Promise<void> {
  try {
    const url = new URL(`https://api.telegram.org/bot${config.telegram.botToken}/getUpdates`);
    url.searchParams.set("timeout", "20");
    url.searchParams.set("allowed_updates", JSON.stringify(["message", "edited_message"]));
    if (telegramPollingOffset > 0) {
      url.searchParams.set("offset", String(telegramPollingOffset));
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed: ${response.status}`);
    }

    const body = await response.json() as { ok?: boolean; result?: TelegramUpdateLike[]; description?: string };
    if (!body.ok) {
      throw new Error(body.description || "Telegram getUpdates failed");
    }

    for (const update of body.result || []) {
      const updateId = Number(update.update_id);
      if (Number.isInteger(updateId)) {
        telegramPollingOffset = Math.max(telegramPollingOffset, updateId + 1);
      }

      await processTelegramMessage(update.message || update.edited_message, "polling");
    }
  } catch (error) {
    audit("telegram_polling_failed", { error: getErrorMessage(error) });
    console.error("[telegram] polling failed", error);
  } finally {
    scheduleTelegramPolling(1000);
  }
}
function parseTelegramSendCommand(
  text: string
): { ok: true; profileId: string | null; to: string; text: string } | { ok: false; error: string } {
  const slashFormat = text.match(/^\/send(?:@\w+)?\s+sms\s*\/\s*([^/]+?)\s*\/\s*([\s\S]+)$/i);
  if (slashFormat) {
    const to = slashFormat[1]?.trim() || "";
    const body = slashFormat[2]?.trim() || "";

    if (!to || !body) {
      return { ok: false, error: "invalid_send_command" };
    }

    return { ok: true, profileId: null, to, text: body };
  }

  const match = text.match(/^\/send(?:@\w+)?(?:\s+--profile\s+(\S+))?\s+(\S+)(?:\s+([\s\S]+))?$/);
  const profileId = match?.[1]?.trim() || null;
  const to = match?.[2]?.trim() || "";
  const body = match?.[3]?.trim() || "";

  if (!to || !body) {
    return { ok: false, error: "invalid_send_command" };
  }

  return { ok: true, profileId, to, text: body };
}

async function sendTelegramReply(text: string): Promise<void> {
  try {
    await sendTelegramMessage(text);
  } catch (error) {
    audit("telegram_reply_failed", { error: getErrorMessage(error) });
    console.error("[telegram] failed to send bot reply", error);
  }
}

function formatTelegramSmsSendError(result: Exclude<SubmitSmsSendResult, { ok: true }>): string {
  if (result.error === "device_offline" || result.error === "device_socket_unavailable") {
    return "Send failed: Android Gateway is offline.";
  }

  if (result.error === "sms_send_rate_limited") {
    return `Send failed: rate limited. Retry after ${result.retryAfterSeconds || 1}s.`;
  }

  if (result.error === "profile_not_found") {
    return "Send failed: profile not found. Use /profiles to view available profiles.";
  }

  if (result.error === "profile_required") {
    return "Send failed: please choose a SIM/Profile first. Use /profiles to view available profiles.";
  }

  if (result.error === "profile_disabled") {
    return "Send failed: profile is disabled. Use /profiles to view available profiles.";
  }

  if (result.error === "sms_send_ack_timeout") {
    return "Send failed: Android Gateway did not return sms_send_submitted. Please update/restart the APK.";
  }

  return `Send failed: ${result.error}`;
}

async function handleTelegramSelection(chatId: string, text: string): Promise<void> {
  const pending = pendingTelegramSmsSelections.get(chatId);
  if (!pending) {
    return;
  }

  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingTelegramSmsSelections.delete(chatId);
    await sendTelegramReply("Selection expired. Please send /send again.");
    return;
  }

  const selection = Number(text);

  if (pending.stage === "device") {
    const devices = pending.devices || [];
    if (!Number.isInteger(selection) || selection < 1 || selection > devices.length) {
      await sendTelegramReply(formatTelegramDeviceSelectionPrompt(devices));
      return;
    }

    const device = devices[selection - 1];
    const profiles = buildTelegramProfileOptions(device.deviceId);
    if (profiles.length === 0) {
      pendingTelegramSmsSelections.delete(chatId);
      await sendTelegramReply(formatNoTelegramProfiles(device));
      return;
    }

    pendingTelegramSmsSelections.set(chatId, {
      stage: "profile",
      to: pending.to,
      text: pending.text,
      createdAt: Date.now(),
      device,
      profiles
    });
    await sendTelegramReply(formatTelegramProfileSelectionPrompt(profiles, device));
    return;
  }

  const profiles = pending.profiles || [];
  if (!Number.isInteger(selection) || selection < 1 || selection > profiles.length) {
    await sendTelegramReply(formatTelegramProfileSelectionPrompt(profiles, pending.device));
    return;
  }

  const profile = profiles[selection - 1];
  pendingTelegramSmsSelections.delete(chatId);
  await submitTelegramSms(chatId, pending.to, pending.text, profile.deviceId, profile.profileId, profiles.length === 1);
}

async function submitTelegramSms(
  chatId: string,
  to: string,
  text: string,
  deviceId: string,
  profileId: string,
  defaultOnly: boolean
): Promise<void> {
  const result = await submitSmsSend({
    actorKey: `telegram:${chatId}:${deviceId}`,
    actorLabel: "Telegram",
    source: "telegram",
    deviceId,
    to,
    text,
    profileId
  });

  if (!result.ok) {
    await sendTelegramReply(formatTelegramSmsSendError(result));
    return;
  }

  const lines = [
    "SMS command submitted.",
    `Device: ${getDeviceDisplayName(result.deviceId)}`,
    `Profile: ${result.profileId}`
  ];

  if (defaultOnly) {
    lines.push("Note: only one SIM/Profile is currently available on this device.");
  }

  await sendTelegramReply(lines.join("\n"));
}

function isPendingTelegramSelection(chatId: string, text: string): boolean {
  return chatId === config.telegram.chatId && /^\d+$/.test(text) && pendingTelegramSmsSelections.has(chatId);
}

function buildTelegramDeviceOptions(): TelegramDeviceOption[] {
  return listStoredDevices().map((device) => ({
    deviceId: device.deviceId,
    displayName: device.displayName,
    online: device.online,
    lastSeenAt: device.lastSeenAt
  }));
}

function buildTelegramProfileOptions(deviceId?: string | null): TelegramProfileOption[] {
  const profiles = deviceId ? listEnabledSimProfilesByDevice(deviceId) : listEnabledSimProfiles();
  return profiles.map(mapTelegramProfileOption);
}

function mapTelegramProfileOption(profile: SimProfile): TelegramProfileOption {
  return {
    deviceId: profile.deviceId || "",
    deviceName: getDeviceDisplayName(profile.deviceId),
    profileId: profile.profileId,
    displayName: profile.displayName,
    carrierName: profile.carrierName,
    phoneNumber: profile.phoneNumber,
    isEnabled: profile.isEnabled,
    isDefaultSms: profile.isDefaultSms
  };
}

function formatTelegramDeviceSelectionPrompt(devices: TelegramDeviceOption[]): string {
  const lines = [
    "Choose sending Device:",
    ...devices.map((device, index) => `${index + 1}. ${formatTelegramDeviceLabel(device)}`),
    "",
    "Reply with the number to continue."
  ];

  return lines.join("\n");
}

function formatTelegramProfileSelectionPrompt(profiles: TelegramProfileOption[], device?: TelegramDeviceOption): string {
  const lines = [
    "Choose sending SIM/Profile:",
    ...(device ? [`Device: ${device.displayName}`, ""] : []),
    ...profiles.map((profile, index) => `${index + 1}. ${formatTelegramProfileLabel(profile)}`),
    "",
    "Reply with the number to send."
  ];

  return lines.join("\n");
}

function formatTelegramDevicesList(devices: TelegramDeviceOption[]): string {
  return [
    "Available Devices:",
    "",
    ...devices.flatMap((device, index) => [
      `${index + 1}. ${device.displayName}`,
      `   deviceId: ${device.deviceId}`,
      `   online: ${device.online}`,
      `   lastSeenAt: ${device.lastSeenAt || "-"}`
    ])
  ].join("\n");
}

function formatTelegramProfilesList(profiles: TelegramProfileOption[]): string {
  return [
    "Available Profiles:",
    "",
    ...profiles.flatMap((profile, index) => [
      `${index + 1}. ${profile.profileId} - ${formatTelegramProfileLabel(profile)}`,
      `   device: ${profile.deviceName}`,
      `   carrierName: ${profile.carrierName || "-"}`,
      `   phoneNumber: ${profile.phoneNumber || "-"}`,
      `   isEnabled: ${profile.isEnabled}`,
      `   isDefaultSms: ${profile.isDefaultSms}`
    ])
  ].join("\n");
}

function formatTelegramSmsUsageError(): string {
  return [
    "Format error.",
    "Use:",
    "/send sms / +13022985056 / message",
    "or:",
    "/send --profile <profileId> +13022985056 message",
    "",
    "Without --profile, the bot will ask you to choose Device, then SIM/Profile."
  ].join("\n");
}

function formatNoTelegramDevices(): string {
  return [
    "No Android Gateway device is available.",
    "Please open the Android app, keep it online, then send /devices again."
  ].join("\n");
}

function formatNoTelegramProfiles(device?: TelegramDeviceOption): string {
  return [
    `No SIM/Profile is available${device ? ` on ${device.displayName}` : ""}.`,
    "Please open the Android app, grant Phone/SMS permissions, keep it online, then send /profiles again."
  ].join("\n");
}

function formatTelegramDeviceLabel(device: TelegramDeviceOption): string {
  return `${device.displayName} - ${device.online ? "Online" : "Offline"}`;
}

function formatTelegramProfileLabel(profile: TelegramProfileOption): string {
  return [
    profile.displayName || profile.profileId,
    profile.phoneNumber || "",
    profile.carrierName || ""
  ].filter(Boolean).join(" - ");
}
function broadcastBrowserEvent(type: string, payload: Record<string, unknown>): void {
  const body = JSON.stringify({
    type,
    payload,
    timestamp: Date.now()
  });

  for (const ws of activeBrowserSockets) {
    if (ws.readyState !== WebSocket.OPEN) {
      activeBrowserSockets.delete(ws);
      continue;
    }

    ws.send(body);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enrichSmsPayloadWithSimProfile(
  deviceId: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const profile = findDeviceSimProfile(deviceId, payload);
  const phoneNumberOverride = findSimPhoneNumberOverride(profile, payload);

  if (!profile) {
    return {
      ...payload,
      to: firstText(payload.to, payload.toNumber, payload.simNumber, phoneNumberOverride)
    };
  }

  return {
    ...payload,
    profileId: firstText(payload.profileId, profile.profileId),
    subscriptionId: firstText(payload.subscriptionId, profile.subscriptionId),
    slotIndex: payload.slotIndex ?? profile.slotIndex,
    carrierName: firstText(payload.carrierName, profile.carrierName, profile.displayName),
    to: firstText(payload.to, payload.toNumber, payload.simNumber, phoneNumberOverride, profile.phoneNumber)
  };
}

function enrichCallPayloadWithSimProfile(
  deviceId: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const profile = findDeviceSimProfile(deviceId, payload);
  const phoneNumberOverride = findSimPhoneNumberOverride(profile, payload);

  if (!profile) {
    return {
      ...payload,
      simNumber: firstText(payload.simNumber, phoneNumberOverride),
      to: firstText(payload.to, payload.toNumber, payload.simNumber, phoneNumberOverride)
    };
  }

  const enriched = {
    ...payload,
    subscriptionId: firstText(payload.subscriptionId, profile.subscriptionId),
    slotIndex: payload.slotIndex ?? profile.slotIndex,
    carrierName: firstText(payload.carrierName, profile.carrierName, profile.displayName),
    simNumber: firstText(payload.simNumber, phoneNumberOverride, profile.phoneNumber),
    to: firstText(payload.to, payload.toNumber, payload.simNumber, phoneNumberOverride, profile.phoneNumber)
  };

  if (enriched.simNumber) {
    console.log("[call] sim number resolved", {
      deviceId,
      profileId: profile.profileId,
      simNumber: enriched.simNumber
    });
  } else {
    console.warn("[call] sim number unavailable for profile", {
      deviceId,
      profileId: profile.profileId,
      subscriptionId: profile.subscriptionId,
      slotIndex: profile.slotIndex
    });
  }

  return enriched;
}

function findSimPhoneNumberOverride(profile: SimProfile | null, payload: Record<string, unknown>): string | null {
  const overrides = config.simPhoneNumberOverrides;
  if (!overrides) {
    return null;
  }

  const keys = [
    firstText(profile?.profileId) ? `profile:${profile?.profileId}` : null,
    firstText(payload.profileId) ? `profile:${firstText(payload.profileId)}` : null,
    firstText(payload.subscriptionId, profile?.subscriptionId) ? `subscription:${firstText(payload.subscriptionId, profile?.subscriptionId)}` : null,
    firstText(payload.slotIndex, profile?.slotIndex) ? `slot:${firstText(payload.slotIndex, profile?.slotIndex)}` : null,
    firstText(profile?.profileId),
    firstText(payload.subscriptionId, profile?.subscriptionId),
    firstText(payload.slotIndex, profile?.slotIndex)
  ];

  for (const key of keys) {
    if (!key) {
      continue;
    }

    const value = overrides[key] || overrides[key.toLowerCase()];
    if (value) {
      return value;
    }
  }

  return null;
}
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();
    if (text) {
      return text;
    }
  }

  return null;
}

function sendDeviceCommand(
  type: string,
  payload: Record<string, unknown>,
  targetDeviceId?: string | null
): { ok: true; deviceId: string } | { ok: false; status: number; error: string } {
  const normalizedTargetDeviceId = normalizeRequestText(targetDeviceId);
  let deviceId = normalizedTargetDeviceId;
  let ws = deviceId ? activeDeviceSockets.get(deviceId) : undefined;

  if (!deviceId) {
    const fallback = Array.from(activeDeviceSockets.entries())
      .find(([, socket]) => socket.readyState === WebSocket.OPEN);

    if (fallback) {
      [deviceId, ws] = fallback;
    }
  }

  if (!deviceId || !ws || ws.readyState !== WebSocket.OPEN) {
    if (type === "send_sms") {
      console.warn("[sms] no online Android Gateway", {
        targetDeviceId: normalizedTargetDeviceId,
        activeDeviceSocketCount: activeDeviceSockets.size
      });
    }
    return { ok: false, status: 409, error: "device_offline" };
  }

  try {
    ws.send(JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    }));
  } catch {
    if (type === "send_sms") {
      console.error("[sms] send command failed to device", {
        deviceId,
        to: payload.to,
        profileId: payload.profileId
      });
    }
    return { ok: false, status: 502, error: "device_command_send_failed" };
  }

  if (type === "send_sms") {
    console.log("[sms] send command sent to device", {
      deviceId,
      to: payload.to,
      profileId: payload.profileId,
      subscriptionId: payload.subscriptionId,
      slotIndex: payload.slotIndex
    });
  }

  return { ok: true, deviceId };
}

function normalizeRequestText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}