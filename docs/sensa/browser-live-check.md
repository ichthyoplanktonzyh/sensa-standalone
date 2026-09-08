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

首轮合计 7 次真实 DeepSeek 请求：1 次字幕翻译、1 次阅读动作、5 次正式意义请求。
`past`、`in the past`、`record`、`bacteria` 的初次正式解释均返回 unresolved；
`bacteria` 在明确关注点后返回有效提案并成功接受。普通阅读动作成功不等于正式意义通过；
自动意义判定仍需进一步校准，不能将这次恢复流程成功写成无需澄清的全自动解释已验收。

## 快轨修复与补充验收

Owner 随后要求修复、验收快轨，并重申领域约束：必要三元组只有 Context、Sense、Expression；
Meaning Focus 只是可选桥梁。代码原本已允许无 Focus 直接接受，本轮没有新增必填关注点或伪造关注点。

正式 Semantic 策略升级为 `consumer-semantic-v4`：明确 null focus 是合法输入；常规搭配、语法和
周围语境可以直接支撑意思，未知子类型/动机/细节不等于不同 Sense。对于仍兼容不同普通实体类型
的真实多义，不能凭频率、空间介词或一般动作强行选义。Proposal 仍需 schema、目标表达一致性、
有效期和账号校验；模型输出不能自行接受或加入学习。保留 v1–v3 provenance 的读取兼容。

本轮新增 **8 次**真实请求，累计 15 次；本地持久上限显式调整为 15，已用完，未重置计数：

| 请求序号 | 验证 | 结果 |
| --- | --- | --- |
| 8–9 | 原 v3，食品安全短句及首轮完整字幕中的 bacteria，无 Focus | 均返回有效 Proposal；首轮失败未稳定复现，不能声称已证明唯一根因 |
| 10–12 | v4 候选：完整字幕 bacteria、She took her time. 中 took her time、存工资语境中的 bank | 均 ready；分别是细菌、从容不迫、金融机构，人工查看核心意义 |
| 13 | 同一候选：He waited by the bank. | 错选河岸，验收失败；因此继续收紧普通实体多义判定 |
| 14 | 最终 v4：同一歧义句 | proposal:null，正确保留慢轨；没有硬编码 bank 的词条路由 |
| 15 | 最终 v4，普通 Chrome 实际 YouTube 字幕 multiply | ready，解释为细菌“繁殖、增殖”；以下原位链路通过 |

最终版本的真实正例是 `multiply`，真实反例是歧义 `bank`；10–12 属于修订前候选的证据。
这些是有界抽查，不是全量语言质量保证；未再付费重复整套矩阵。可执行抽查入口在
`scripts/support/semanticLiveChecks.mts`，只由显式 live harness 调用，不进入普通测试/CI。

实际原位流程与持久化结果：

1. 保留用户已打开的普通 Chrome 和实际字幕，选中 `multiply`，点击「句中解释」。没有输入 Focus。
2. 浮层显示正式解释和「加入 Sensa」。此时服务端 lookup ready、focus 为 null，意义数仍为 1，解析本身没有保存。
3. 在 YouTube 浮层直接点击「加入 Sensa」。插件显示本机保存反馈，随后弹窗显示「已加入 Sensa · multiply」及「0 项待同步」。
4. Postgres 完整意义数从 1 到 2；Intake 总数保持 4（其中待处理 3），学习目标和学习运行均保持 0。
5. 新意义 `d0359778-1b17-4886-8f93-0c5a6276dfeb`，对应 lookup `15bc2d42-88d2-433f-99c5-f2192ceb4319`，
   Focus 为 SQL NULL，表达字符区间 `344–352`，视频上下文 `23000–47760 ms`，provenance 为 v4。
6. 保存完成后才从插件最近记录打开 Web，显示「已确认的意思」「意思已保存。加入学习需单独选择。」和来源 `t=23s`；刷新后仍存在。Web 只是检查结果，不是快轨的中间步骤。

免费验证：`sensaBrowserReadingApiSmoke.mts` 增加无 Focus lookup 不写 inventory、无 Intake 的直接接受、
重放不重复、无学习副作用、未确定不可接受，以及显式澄清仍可产生 Proposal 的断言；通过真实 API/隔离 Postgres。
`--browser` 的已安装扩展/真实后台/HTTP 保存回归通过。`sensaExtensionReadingSmoke.mts` 的实际浏览器
工具栏 lookup → accept、无 save 操作、错误/未确定不展示接受、迟到结果及重放回归通过。
根级 typecheck、production build、lint 通过（lint 仍是 typecheck，build 保留已有大 bundle 提示）。
没有生成学习材料、调用 TTS、推送或云端部署。本轮修改在服务端及合同，已安装插件无需重新加载即可完成上述验收。

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
- 新本地脚本持久保存签名密钥、vault key 和请求计数到忽略目录，文件权限 0600；默认上限 8 次，重启不清零。后续快轨轮显式把累计上限设为 15，目前剩余 0 次。

显式启动命令（仓库根目录，迁移需预先应用）：

```sh
SENSA_LIVE_DATABASE=sensa_m1a_m2_c node --env-file=apps/api/.env --env-file=.env --import tsx scripts/sensaBrowserLiveExperience.mts --live
npm run preview -w @sensa/web -- --port 3001
```

脚本仅允许 loopback、指定名称的体验数据库及显式 `--live`，未接入普通测试/CI。
新获授权的有界验证可用 `--request-limit=<累计上限>`，不得小于已用次数，最多比已用次数多 8；
不会覆盖签名密钥或清零计数。先停止已有 harness 再运行质量抽查，避免两个进程共享预算状态：
`--live --semantic-check` 跑四个语义样例；`--case=ambiguous-noun` 可只复测一个样例。
无 `--live` 的拒绝路径已验证；本轮根级 typecheck、production build、lint 和字幕浏览器回归通过。
浏览器工具禁止访问扩展管理页，因此 owner 手动完成加载/重载，后续连接、划词、保存、
澄清、接受与回访由代理直接操作普通 Chrome。未通过其他方式绕过管理页限制。
