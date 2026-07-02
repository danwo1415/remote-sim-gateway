# GitHub Setup

Repository:

```text
https://github.com/danwo1415/remote-sim-gateway.git
```

## 上传方式 A：GitHub 网页上传

1. 打开仓库页面。
2. 点击 `uploading an existing file`。
3. 上传本项目解压后的全部文件。
4. 提交到 `main` 分支。
5. 进入 `Actions`，运行 `Build Android APK`。

## 上传方式 B：命令行上传

```bash
git clone https://github.com/danwo1415/remote-sim-gateway.git
cd remote-sim-gateway

# 将本项目文件复制进该目录后执行：
git add .
git commit -m "Initial project structure"
git push origin main
```

## APK 下载

构建完成后：

1. 进入 `Actions`
2. 点击最新一次 workflow run
3. 滚动到底部 `Artifacts`
4. 下载 `remote-sim-gateway-debug-apk`
