import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { config } from "./config.js";
import { getDeviceStatus, markDeviceOffline, markDeviceOnline, markDeviceSeen } from "./deviceState.js";
import { isDeviceAllowed } from "./auth.js";
import { forwardIncomingSmsEmail } from "./mailer.js";
import { audit } from "./audit.js";
import {
  getUnreadSmsCount,
  listSmsMessages,
  markAllSmsRead,
  parseSmsLimit,
  saveIncomingSms
} from "./smsStore.js";
import {
  getResponseSession,
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
const lastSmsSendByEmail = new Map<string, number>();

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

app.use("/api", requireSession);

app.get("/api/device/status", (_req, res) => {
  res.json(getDeviceStatus());
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
  const profileId = req.body?.profileId ? String(req.body.profileId).trim() : undefined;

  if (!to || !text) {
    res.status(400).json({ error: "to_and_text_required" });
    return;
  }

  const now = Date.now();
  const lastSentAt = lastSmsSendByEmail.get(session.email) || 0;
  const retryAfterMs = config.smsSendIntervalMs - (now - lastSentAt);

  if (retryAfterMs > 0) {
    res.status(429).json({
      error: "sms_send_rate_limited",
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    });
    return;
  }

  const result = sendDeviceCommand("send_sms", {
    to,
    text,
    ...(profileId ? { profileId } : {})
  });

  if (!result.ok) {
    audit("sms_send_failed", { email: session.email, to, reason: result.error });
    res.status(result.status).json({ error: result.error });
    return;
  }

  lastSmsSendByEmail.set(session.email, now);
  audit("sms_send_submitted", { email: session.email, to, profileId, deviceId: result.deviceId });
  res.json({
    ok: true,
    deviceId: result.deviceId
  });
});

app.use(express.static(webRoot));

const server = http.createServer(app);

const wss = new WebSocketServer({
  noServer: true
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");

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

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit("connection", ws, req, normalizedDeviceId);
  });
});

wss.on("connection", (ws: WebSocket, _req: http.IncomingMessage, deviceId: string) => {
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
