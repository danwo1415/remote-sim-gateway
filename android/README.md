# Remote SIM Gateway Android App V0.1

这是 Remote SIM Gateway 的 Android 端源码骨架。

## 当前版本定位

V0.1 不是完整成品 APK，而是 Android App 工程骨架，用于启动后续开发。

已包含：

- 极简 Android UI
- 权限申请
- Device ID / Device Key 生成
- 前台服务 GatewayService
- WebSocket 客户端骨架
- 接收短信 BroadcastReceiver
- 发送短信 SmsManager
- 发起拨号 ACTION_CALL
- 接听电话 TelecomManager.acceptRingingCall()
- 通话状态监听骨架

尚未完成：

- 与 VPS 的完整事件总线
- 真实后端协议
- 来电/短信实时上传
- 通话录音
- WebRTC 实时语音
- 不同 Android 版本兼容性处理
- 完整错误处理与重连机制

## 需要修改

打开：

`app/src/main/java/com/example/remotesimgateway/GatewayService.kt`

修改：

```kotlin
serverUrl = "wss://YOUR_DOMAIN_HERE/ws/device"
```

为你的 VPS WebSocket 地址。

## 构建方式

用 Android Studio 打开本目录，等待 Gradle 同步，然后连接 Android 手机运行。

## 安全说明

- Device Key 首次安装时本地生成。
- 服务器必须只接受已绑定 Device ID / Device Key。
- 不要使用 HTTP。
- 生产环境请使用正式域名和 HTTPS/WSS。
- 该 App 只应用于你自己拥有或被授权管理的 SIM 卡与设备。

## GitHub Actions 自动生成 APK

本版本已包含：

`.github/workflows/android-apk.yml`

使用方式：

1. 在 GitHub 创建一个新仓库。
2. 上传本项目全部文件。
3. 进入 GitHub 仓库的 `Actions` 页面。
4. 选择 `Build Android APK`。
5. 点击 `Run workflow` 手动运行，或直接 push 到 main/master 分支自动运行。
6. 构建完成后，在 workflow run 页面底部的 `Artifacts` 下载：

`remote-sim-gateway-debug-apk`

里面就是 Debug APK。

注意：

- Debug APK 适合测试安装。
- 正式使用建议后续配置 Release 签名。
- Release 签名文件不要上传到 GitHub 仓库。
