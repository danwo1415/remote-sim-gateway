import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { getDeviceStatus, markDeviceOffline, markDeviceOnline, markDeviceSeen } from "./deviceState.js";
import { isDeviceAllowed } from "./auth.js";

const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../../web");

const app = express();

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

app.get("/api/device/status", (_req, res) => {
  res.json(getDeviceStatus());
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
  console.log(`[device] online: ${deviceId}`);

  ws.on("message", (raw: RawData) => {
    markDeviceSeen();
    console.log(`[device] message: ${raw.toString()}`);
  });

  ws.on("close", () => {
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
