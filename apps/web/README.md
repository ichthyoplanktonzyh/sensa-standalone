# Sensa Web

`apps/web` 是生产 React 应用。产品行为见 [`docs/sensa/product-requirements-v1.md`](../../docs/sensa/product-requirements-v1.md)，数据、验证和发布见 [`docs/sensa/engineering.md`](../../docs/sensa/engineering.md)。

```sh
npm run web:dev
npm run web:build
npm run web:preview
```

从 `.env.example` 创建 `.env.local`。其中只允许 `VITE_*` 公共浏览器配置，不得放入服务端密钥。

开发和构建会先运行 `scripts/prepareWebMedia.mjs`。它从 `content/data/media/audio` 或 `SENSA_WEB_MEDIA_ROOT` 读取已批准音频，校验声明的 SHA-256，只把当前发布需要的文件暂存到忽略目录 `apps/web/public/golden-audio`。缺失或摘要不匹配会使构建失败；该步骤不生成媒体，也不调用付费服务。
