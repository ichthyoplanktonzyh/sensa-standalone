# Borrow / lend 高保证包：本机使用

2026-09-11 已接入当前 Web 学习包目录。

1. 打开 3001 的“我的学习 → 添加学习”，刷新学习包列表。
2. 选择 **Borrow & lend · 高保证学习**，下载后点击“加入学习”。
3. 点击“去学习”，也可以从包内 borrow / lend 的详情开始。
4. 首次开始时确认每天新增数量。此包固定高保证方法：经验建立后，依次接受执行器
   安排的识别、回想、迁移、边界及必要修复。发音和教学例句在表达揭示后可播放。

也可以点击“导入学习包”，选择本机生成的
`release-candidate/borrow-lend-assurance-v1.json`。导入只安装资源，需要再次明确加入学习。
已有八词轻量包仍保留；同名词在这两个发布来源下的 Sense 版本及方法不同，不自动合并历史。

开发者重建：先构建 learning-kernel、contracts、content-validator，再执行
`npm run sensa:build-assurance-package`。该命令只使用现有发布 JSON 和
`content/data/media/audio` 中经哈希验证的音频，不生成音频、不调用模型、不部署。
输出为 `release-candidate/learning-packages/<id>-<sha256>.json` 与独立的
`release-candidate/assurance-catalog.json`。云端如需此包，应通过现有 CI/CD 交付资源
并合并正式目录；本轮只更新本机试用目录。
