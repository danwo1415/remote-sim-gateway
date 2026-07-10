import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { config } from "./config.js";
import { getDeviceStatus, markDeviceOffline, markDeviceOnline, markDeviceSeen } from "./deviceState.js";
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
  listEnabledSimProfiles,
  resolveSmsProfile,
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
  res.json(getDeviceStatus());
});

app.get("/api/sim/profiles", (_req, res) => {
  const refreshResult = sendDeviceCommand("refresh_sim_profiles", {});
  if (!refreshResult.ok) {
    console.warn("[sim] refresh_sim_profiles not sent", { reason: refreshResult.error });
  }

  const profiles = listEnabledSimProfiles();
  console.log("[sim] profiles requested", {
    count: profiles.length,
    deviceRefreshSent: refreshResult.ok
  });

  res.json({
    defaultProfile: null,
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
  const messages = listSmsMessages(parseSmsLimit(req.query.limit));
  res.json({
    count: messages.length,
    unreadCount: getUnreadSmsCount(),
    messages
  });
});

app.post("/api/sms/mark-read", (_req, res) => {
  const session = getResponseSession(res);
  const changed = markAllSmsRead();
  audit("sms_mark_read", { email: session.email, count: changed });
  res.json({
    ok: true,
    changed,
    unreadCount: getUnreadSmsCount()
  });
});

app.post("/api/sms/send", (req, res) => {
  void handleWebSmsSend(req, res);
});

async function handleWebSmsSend(req: Request, res: Response): Promise<void> {
  const session = getResponseSession(res);
  const to = String(req.body?.to || "").trim();
  const text = String(req.body?.text || "").trim();
  const profileId = String(req.body?.profileId || "").trim();

  console.log("[sms] send request received", {
    source: "web",
    actor: session.email,
    to,
    profileId,
    textLength: text.length
  });

  if (!to || !text) {
    res.status(400).json({ error: "to_and_text_required" });
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
    to,
    text,
    profileId
  });

  if (!result.ok) {
    res.status(result.status).json({
      error: result.error,
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
    });
    return;
  }

  res.json({
    ok: true,
    deviceId: result.deviceId,
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
    const session = getRequestSession(req, true);

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

  const normalizedDeviceId = Array.isArray(deviceId) ? deviceId[0] : deviceId;
  const normalizedDeviceKey = Array.isArray(deviceKey) ? deviceKey[0] : deviceKey;

  if (!isDeviceAllowed(normalizedDeviceId, normalizedDeviceKey)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  deviceWss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    deviceWss.emit("connection", ws, req, normalizedDeviceId);
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

deviceWss.on("connection", (ws: WebSocket, _req: http.IncomingMessage, deviceId: string) => {
  markDeviceOnline(deviceId);
  activeDeviceSockets.set(deviceId, ws);
  console.log(`[device] online: ${deviceId}`);

  ws.on("message", (raw: RawData) => {
    markDeviceSeen();

    const text = raw.toString();
    console.log(`[device] message: ${text}`);

    try {
      const json = JSON.parse(text);
      const type = json.type;
      const payload = json.payload || {};

      if (type === "sim_profiles") {
        const profiles = syncDeviceSimProfiles(deviceId, payload.profiles);
        audit("sim_profiles_sync", {
          deviceId,
          count: profiles.length,
          error: payload.error
        });

        broadcastBrowserEvent("sim_profiles_updated", {
          profiles: listEnabledSimProfiles()
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
        const call = saveIncomingCall(deviceId, payload);
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
        const call = markCallAnswered(deviceId, payload);
        audit("call_answered", {
          deviceId,
          callId: call.id,
          phoneNumber: call.phoneNumber,
          answeredAt: call.answeredAt
        });
      }

      if (type === "call_ended") {
        const call = markCallEnded(deviceId, payload);
        audit("call_ended", {
          deviceId,
          callId: call.id,
          phoneNumber: call.phoneNumber,
          status: call.status,
          ringDurationSeconds: call.ringDurationSeconds
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
        const savedSms = saveIncomingSms(deviceId, payload);
        const unreadCount = getUnreadSmsCount();

        console.log("========== INCOMING SMS ==========");
        console.log(`Saved ID: ${savedSms.id}`);
        console.log(`From: ${payload.from || "unknown"}`);
        console.log(`Timestamp: ${payload.timestamp || ""}`);
        console.log(`Body: ${payload.body || ""}`);
        console.log("==================================");

        void forwardIncomingSmsEmail(deviceId, payload)
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
      markDeviceOffline();
      console.log(`[device] offline: ${deviceId}`);
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
});

type SmsSendSource = "web" | "telegram";

type SubmitSmsSendInput = {
  actorKey: string;
  actorLabel: string;
  source: SmsSendSource;
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

type TelegramProfileOption = {
  profileId: string;
  displayName: string;
  carrierName: string | null;
  phoneNumber: string | null;
  isEnabled: boolean;
  isDefaultSms: boolean;
};

type PendingTelegramSmsSelection = {
  to: string;
  text: string;
  createdAt: number;
  profiles: TelegramProfileOption[];
};

async function submitSmsSend(input: SubmitSmsSendInput): Promise<SubmitSmsSendResult> {
  let profile;

  try {
    profile = resolveSmsProfile(input.profileId);
  } catch (error) {
    const message = getErrorMessage(error);
    audit("sms_send_failed", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: input.profileId,
      reason: message
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
  const result = sendDeviceCommand("send_sms", commandPayload);

  if (!result.ok) {
    cancelSmsSendAck(commandId);
    audit("sms_send_failed", {
      source: input.source,
      actor: input.actorLabel,
      to: input.to,
      profileId: profile.profileId,
      reason: result.error
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

  return {
    ok: true,
    deviceId: result.deviceId,
    profileId: profile.profileId,
    note: profile.note
  };
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
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.warn("[telegram] webhook ignored: bot token or chat id is not configured");
    res.json({ ok: true });
    return;
  }

  const message = req.body?.message || req.body?.edited_message;
  const chatId = message?.chat?.id === undefined ? "" : String(message.chat.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const isKnownCommand = text.startsWith("/send") || text.startsWith("/profiles");

  if (isKnownCommand || isPendingTelegramSelection(chatId, text)) {
    console.log("[telegram] webhook command received", {
      chatId,
      text: text.slice(0, 80)
    });
  }

  if (!isKnownCommand && !isPendingTelegramSelection(chatId, text)) {
    res.json({ ok: true });
    return;
  }

  if (chatId !== config.telegram.chatId) {
    console.warn("[telegram] command rejected: chat id is not allowed", { chatId });
    audit("telegram_sms_send_rejected", { chatId, reason: "chat_not_allowed" });
    res.json({ ok: true });
    return;
  }

  if (isPendingTelegramSelection(chatId, text)) {
    await handleTelegramProfileChoice(chatId, text);
    res.json({ ok: true });
    return;
  }

  if (text.startsWith("/profiles")) {
    const profiles = buildTelegramProfileOptions();
    await sendTelegramReply(profiles.length > 0 ? formatTelegramProfilesList(profiles) : formatNoTelegramProfiles());
    res.json({ ok: true });
    return;
  }

  const parsed = parseTelegramSendCommand(text);
  if (!parsed.ok) {
    audit("telegram_sms_send_failed", { chatId, reason: parsed.error });
    await sendTelegramReply(formatTelegramSmsUsageError());
    res.json({ ok: true });
    return;
  }

  if (!parsed.profileId) {
    const profiles = buildTelegramProfileOptions();
    if (profiles.length === 0) {
      await sendTelegramReply(formatNoTelegramProfiles());
      res.json({ ok: true });
      return;
    }

    pendingTelegramSmsSelections.set(chatId, {
      to: parsed.to,
      text: parsed.text,
      createdAt: Date.now(),
      profiles
    });
    await sendTelegramReply(formatTelegramProfileSelectionPrompt(profiles));
    res.json({ ok: true });
    return;
  }

  await submitTelegramSms(chatId, parsed.to, parsed.text, parsed.profileId, buildTelegramProfileOptions().length === 1);
  res.json({ ok: true });
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

async function handleTelegramProfileChoice(chatId: string, text: string): Promise<void> {
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
  if (!Number.isInteger(selection) || selection < 1 || selection > pending.profiles.length) {
    await sendTelegramReply(formatTelegramProfileSelectionPrompt(pending.profiles));
    return;
  }

  const profile = pending.profiles[selection - 1];
  pendingTelegramSmsSelections.delete(chatId);
  await submitTelegramSms(chatId, pending.to, pending.text, profile.profileId, pending.profiles.length === 1);
}

async function submitTelegramSms(
  chatId: string,
  to: string,
  text: string,
  profileId: string,
  defaultOnly: boolean
): Promise<void> {
  const result = await submitSmsSend({
    actorKey: `telegram:${chatId}`,
    actorLabel: "Telegram",
    source: "telegram",
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
    `Profile: ${result.profileId}`
  ];

  if (defaultOnly) {
    lines.push("Note: only one SIM/Profile is currently available.");
  }

  await sendTelegramReply(lines.join("\n"));
}

function isPendingTelegramSelection(chatId: string, text: string): boolean {
  return chatId === config.telegram.chatId && /^\d+$/.test(text) && pendingTelegramSmsSelections.has(chatId);
}

function buildTelegramProfileOptions(): TelegramProfileOption[] {
  const profiles = listEnabledSimProfiles();
  return profiles.map(mapTelegramProfileOption);
}

function mapTelegramProfileOption(profile: SimProfile): TelegramProfileOption {
  return {
    profileId: profile.profileId,
    displayName: profile.displayName,
    carrierName: profile.carrierName,
    phoneNumber: profile.phoneNumber,
    isEnabled: profile.isEnabled,
    isDefaultSms: profile.isDefaultSms
  };
}

function formatTelegramProfileSelectionPrompt(profiles: TelegramProfileOption[]): string {
  const lines = [
    "Choose sending SIM/Profile:",
    ...profiles.map((profile, index) => `${index + 1}. ${formatTelegramProfileLabel(profile)}`),
    "",
    "Reply with the number to send."
  ];

  return lines.join("\n");
}

function formatTelegramProfilesList(profiles: TelegramProfileOption[]): string {
  return [
    "Available Profiles:",
    "",
    ...profiles.flatMap((profile, index) => [
      `${index + 1}. ${profile.profileId} - ${formatTelegramProfileLabel(profile)}`,
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
    "/send --profile <profileId> +13022985056 message"
  ].join("\n");
}

function formatNoTelegramProfiles(): string {
  return [
    "No SIM/Profile is available.",
    "Please open the Android app, grant Phone/SMS permissions, keep it online, then send /profiles again."
  ].join("\n");
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

function sendDeviceCommand(
  type: string,
  payload: Record<string, unknown>
): { ok: true; deviceId: string } | { ok: false; status: number; error: string } {
  const deviceStatus = getDeviceStatus();
  let deviceId = deviceStatus.deviceId;
  let ws = deviceId ? activeDeviceSockets.get(deviceId) : undefined;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const fallback = Array.from(activeDeviceSockets.entries())
      .find(([, socket]) => socket.readyState === WebSocket.OPEN);

    if (fallback) {
      [deviceId, ws] = fallback;
    }
  }

  if (!deviceId || !ws || ws.readyState !== WebSocket.OPEN) {
    if (type === "send_sms") {
      console.warn("[sms] no online Android Gateway", {
        statusOnline: deviceStatus.online,
        statusDeviceId: deviceStatus.deviceId,
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
