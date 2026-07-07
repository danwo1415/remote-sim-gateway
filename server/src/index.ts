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
  DEFAULT_PROFILE_ID,
  listEnabledSimProfiles,
  resolveSmsProfile,
  upsertSimProfile
} from "./profileStore.js";
import {
  getUnreadSmsCount,
  listSmsMessages,
  markAllSmsRead,
  parseSmsLimit,
  saveIncomingSms
} from "./smsStore.js";
import { forwardIncomingSmsTelegram, sendTelegramMessage } from "./telegram.js";
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
  res.json({
    defaultProfile: {
      profileId: DEFAULT_PROFILE_ID,
      displayName: "默认 SIM",
      isEnabled: true,
      isDefaultSms: true
    },
    profiles: listEnabledSimProfiles()
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
  const session = getResponseSession(res);
  const to = String(req.body?.to || "").trim();
  const text = String(req.body?.text || "").trim();
  const profileId = req.body?.profileId ? String(req.body.profileId).trim() : DEFAULT_PROFILE_ID;

  if (!to || !text) {
    res.status(400).json({ error: "to_and_text_required" });
    return;
  }

  const result = submitSmsSend({
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
    note: result.note
  });
});

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
    }
    markDeviceOffline();
    console.log(`[device] offline: ${deviceId}`);
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

function submitSmsSend(input: SubmitSmsSendInput): SubmitSmsSendResult {
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

  const commandPayload = {
    to: input.to,
    text: input.text,
    profileId: profile.profileId,
    ...(profile.subscriptionId ? { subscriptionId: profile.subscriptionId } : {}),
    ...(profile.slotIndex !== undefined ? { slotIndex: profile.slotIndex } : {})
  };

  const result = sendDeviceCommand("send_sms", commandPayload);

  if (!result.ok) {
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
  audit("sms_send_submitted", {
    source: input.source,
    actor: input.actorLabel,
    to: input.to,
    profileId: profile.profileId,
    deviceId: result.deviceId,
    note: profile.note
  });

  return {
    ok: true,
    deviceId: result.deviceId,
    profileId: profile.profileId,
    note: profile.note
  };
}

async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    res.json({ ok: true });
    return;
  }

  const message = req.body?.message || req.body?.edited_message;
  const chatId = message?.chat?.id === undefined ? "" : String(message.chat.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";

  if (!text.startsWith("/send")) {
    res.json({ ok: true });
    return;
  }

  if (chatId !== config.telegram.chatId) {
    audit("telegram_sms_send_rejected", { chatId, reason: "chat_not_allowed" });
    res.json({ ok: true });
    return;
  }

  const parsed = parseTelegramSendCommand(text);
  if (!parsed.ok) {
    audit("telegram_sms_send_failed", { chatId, reason: parsed.error });
    await sendTelegramReply("❌ 格式错误，请使用：\n/send +13022985056 短信内容");
    res.json({ ok: true });
    return;
  }

  const result = submitSmsSend({
    actorKey: `telegram:${chatId}`,
    actorLabel: "Telegram",
    source: "telegram",
    to: parsed.to,
    text: parsed.text,
    profileId: DEFAULT_PROFILE_ID
  });

  if (!result.ok) {
    await sendTelegramReply(formatTelegramSmsSendError(result));
    res.json({ ok: true });
    return;
  }

  await sendTelegramReply("✅ 短信发送指令已提交");
  res.json({ ok: true });
}

function parseTelegramSendCommand(text: string): { ok: true; to: string; text: string } | { ok: false; error: string } {
  const match = text.match(/^\/send(?:@\w+)?\s+(\S+)(?:\s+([\s\S]+))?$/);
  const to = match?.[1]?.trim() || "";
  const body = match?.[2]?.trim() || "";

  if (!to || !body) {
    return { ok: false, error: "invalid_send_command" };
  }

  return { ok: true, to, text: body };
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
    return "❌ Android Gateway 当前离线，无法发送";
  }

  if (result.error === "sms_send_rate_limited") {
    return `❌ 发送过于频繁，请 ${result.retryAfterSeconds || 1} 秒后再试`;
  }

  return "❌ 短信发送指令提交失败";
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
  const deviceId = deviceStatus.deviceId;

  if (!deviceStatus.online || !deviceId) {
    return { ok: false, status: 409, error: "device_offline" };
  }

  const ws = activeDeviceSockets.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { ok: false, status: 409, error: "device_socket_unavailable" };
  }

  try {
    ws.send(JSON.stringify({
      type,
      payload,
      timestamp: Date.now()
    }));
  } catch {
    return { ok: false, status: 502, error: "device_command_send_failed" };
  }

  return { ok: true, deviceId };
}
