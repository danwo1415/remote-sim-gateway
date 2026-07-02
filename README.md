# Remote SIM Gateway

Remote SIM Gateway 是一个面向个人用户的极简远程 SIM 控制工具。

它不是远程控制 Android 手机，而是远程控制一张 SIM 卡。

## V1.0 功能范围

仅包含四项核心能力：

- 接收短信
- 发送短信
- 接听电话
- 拨打电话

## 项目结构

```text
remote-sim-gateway/
├── android/              # Android SIM Gateway App
├── web/                  # 极简 Web UI
├── docs/                 # 产品、安全、技术文档
├── .github/workflows/    # GitHub Actions 自动构建 APK
└── README.md
```

## Android APK 自动构建

本仓库包含 GitHub Actions：

```text
.github/workflows/android-apk.yml
```

上传到 GitHub 后：

1. 进入仓库 `Actions`
2. 选择 `Build Android APK`
3. 点击 `Run workflow`
4. 构建完成后，在页面底部 `Artifacts` 下载 Debug APK

## Web Demo

打开：

```text
web/index.html
```

可查看最终 UI demo。
