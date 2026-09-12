# Sensa 浏览器扩展

扩展负责网页和字幕阅读、选区采集、解释以及向生产 Web 交接。用户行为见 [`docs/sensa/product-requirements-v1.md`](../../docs/sensa/product-requirements-v1.md)，工程边界见 [`docs/sensa/engineering.md`](../../docs/sensa/engineering.md)。

构建：

```sh
npm run build -w @sensa/browser-extension
```

本机开发可在 Chrome 扩展开发者模式加载 `apps/browser-extension/dist`。重新构建后需要重新加载扩展，并刷新已经打开的 Sensa 页面。

正式构建必须设置 `SENSA_EXTENSION_WEB_URL` 和 `SENSA_EXTENSION_API_URL`；非 loopback 地址必须使用 HTTPS。模型密钥不得进入扩展 bundle 或 storage，`dist/` 不提交 Git。

无付费交互检查：

```sh
node --import tsx scripts/sensaBrowserPortSmoke.mts
node --import tsx scripts/sensaExtensionDismissSmoke.mts
node --import tsx scripts/sensaExtensionPopupSmoke.mts
```

这些检查使用本地或受控替身，不证明真实第三方站点、浏览器商店安装或真实模型质量。
