# 普通 Chrome 与真实 DeepSeek 链路验证

2026-09-08。Owner 授权直接操作其打开的普通浏览器，并使用既有 DeepSeek API。
使用 owner 当前普通 Chrome，实际 Sensa 0.2.0 扩展、本地账号版 Web、实际 API 和 Postgres。
本记录属于实测证据，不扩大生产支持范围。

## 实际结果

视频：YouTube `NfNHImQPHJc`，CNN 10 的《How an AI chatbot is helping this blind man 'see' for the first time》。

1. 通过 Chrome 工具栏打开插件，走实际账号连接和 activeTab 开启阅读流程。
2. 实际读取 272 条英文字幕，未导入夹具、替代字幕或伪造成功结果。
3. DeepSeek 成功翻译当前字幕；普通阅读动作正确解释 `bacteria` 在食品安全报道中的含义。
4. `past` 在解释未确定时仍可保存；Web 收件箱出现原句、表达及视频定位 `71880–76080 ms`，来源链接为 `t=71s`。
5. 实测发现字幕断行缺少上下文，修复后重新加载插件/视频，同一批字幕组合为 59 段有界上下文。
6. 保存 `bacteria` 及其上下文，Web 收件箱同步成功。补充与原文一致的关注点后，正式 lookup 返回 ready；确认后创建 Personal Meaning，UI 显示“意思已保存。加入学习需单独选择。”
7. 从意义详情实际点击来源链接，打开 `watch?v=NfNHImQPHJc&t=23s`；播放器显示从该位置开始播放。数据库保存上下文区间 `23000–47760 ms`、表达、关注点和接受结果。

本地意义记录：`e96f7b79-2833-41ab-8f05-3b76c84a45db`。没有将其加入学习，没有生成学习材料或 TTS。
视频定位指向已保存上下文的起点，目前不是所选单词的逐词时间戳。

合计 7 次真实 DeepSeek 请求：1 次字幕翻译、1 次阅读动作、5 次正式意义请求。
`past`、`in the past`、`record`、`bacteria` 的初次正式解释均返回 unresolved；
`bacteria` 在明确关注点后返回有效提案并成功接受。普通阅读动作成功不等于正式意义通过；
自动意义判定仍需进一步校准，不能将这次恢复流程成功写成无需澄清的全自动解释已验收。

## 按源码发现并修复的问题

新增阅读了 Read Frog 固定提交 `e3cbe2b7c669c875dbf1b050254da9b628daefe1` 的
`src/utils/subtitles/fetchers/youtube/parser/scrolling-asr-parser.ts` 与
`src/utils/subtitles/processor/optimizer.ts`。它们把字幕显示行与语义片段分开处理，
在句界、长度和时间间隔处切分/合并，避免直接把字幕行当作完整语句。

Sensa 独立增加相邻字幕的有界拼接：保留文字与起止时间，在行尾句末标点、超过 2 秒
间隔、25 秒时长或 1200 字符附近停止。不会跨整段视频无界拼接；但目前仍可能形成多句
段落，尚未实现完整的逐词时间对齐、复杂滚动/重绘去重和段内精细句界切分。
浏览器回归将原来的一句夹具拆成两条原始字幕，验证展示/选择和毫秒来源保存仍然正确。

## 恢复的本地体验环境

开始时仅 3000 端口的预览原型运行，原 3001/4319 服务已停止。保留该预览原型，恢复：

- Web：`http://127.0.0.1:3001/`，账号版生产构建。
- API：`http://127.0.0.1:4319/`，实际消费 API，登录为显式本地 synthetic auth，不是 Supabase 邮件服务。
- 数据库：既有 `sensa_m1a_m2_c`。只增量应用 0021 阅读迁移；保留原账号、材料和记录。
- 真实模型密钥只从根目录已有 `.env` 读取。运行脚本不输出密钥，也不写扩展 storage。
- 新本地脚本持久保存签名密钥、vault key 和请求计数到忽略目录，文件权限 0600；最多 8 次 DeepSeek 请求，重启不清零。剩余 1 次。

显式启动命令（仓库根目录，迁移需预先应用）：

```sh
SENSA_LIVE_DATABASE=sensa_m1a_m2_c node --env-file=apps/api/.env --env-file=.env --import tsx scripts/sensaBrowserLiveExperience.mts --live
npm run preview -w @sensa/web -- --port 3001
```

脚本仅允许 loopback、指定名称的体验数据库及显式 `--live`，未接入普通测试/CI。
无 `--live` 的拒绝路径已验证；本轮根级 typecheck、production build、lint 和字幕浏览器回归通过。
浏览器工具禁止访问扩展管理页，因此 owner 手动完成加载/重载，后续连接、划词、保存、
澄清、接受与回访由代理直接操作普通 Chrome。未通过其他方式绕过管理页限制。
