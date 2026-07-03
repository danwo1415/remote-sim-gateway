# Remote SIM Gateway Server M1.1

M1.1 目标：设备上线。

本阶段只实现：

- `GET /health`
- `GET /api/device/status`
- `WS /ws/device`

## 本地运行

```bash
cd server
npm install
npm run dev
```

打开：

```text
http://localhost:3000/health
```

如果返回：

```json
{"ok":true}
```

说明服务正常。

## 设备连接

Android App 连接：

```text
ws://YOUR_SERVER/ws/device
```

或生产环境：

```text
wss://YOUR_DOMAIN/ws/device
```

请求头必须包含：

```text
X-Device-Id
X-Device-Key
```

M1.1 暂时用环境变量绑定设备：

```text
DEVICE_ID=...
DEVICE_KEY=...
```

## 状态接口

```text
GET /api/device/status
```
