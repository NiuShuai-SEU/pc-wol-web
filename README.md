# PC WOL Web

精简、安全的静态远程开机网页，无后端、无第三方 JS 依赖。

## 一键部署到 EdgeOne Pages

[![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FNiuShuai-SEU%2Fpc-wol-web&project-name=pc-wol-web)

## 固定参数

- EMQX WSS: `wss://sfe0f5f7.ala.cn-hangzhou.emqxsl.cn:8084/mqtt`
- MQTT Topic: `home/pc/wol`
- Payload: `wake`
- QoS: `0`
- Retain: `false`

## 本地运行

不要直接双击 `index.html`。在本目录启动静态 HTTP 服务：

```powershell
python -m http.server 8080
```

浏览器打开：

```text
http://127.0.0.1:8080
```

第一次打开时输入：

- 用户名：`pc-wol-controller`
- 密码：你在 EMQX 中为该用户设置的密码

如不勾选“记住此设备”，密码只存在当前页面内存中；勾选后会保存在浏览器 localStorage。
