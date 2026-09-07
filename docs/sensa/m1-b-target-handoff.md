# M1-B：目标加入与材料就绪

> 2026-09-07；本地纵切已验证，云端与受邀生产内容发布尚未验收。
> 前置 checkpoint：`6157648d`（M1-A）。Owner 授权每条用例线完成验证后提交 checkpoint。

## 用户结果

正式模式从首页选择学习内容、查看具体意思并加入学习。加入先写本机 outbox，再由服务器
验证稳定 Sense/Binding、来源、语言上下文和轻量 Policy，创建对应 Target、成员和准备计划。
同一连接从目录/词书重复加入会合并，保留两个合法来源；无须先创建 Personal Meaning。
首次成员创建后，固定材料通过校验进入 ready；校验失败保留成员并显示原因。就绪后回首页，
不在详情开 Run；真正首学入口在下一条 M1-C 接通。

支持离线保存加入意图、API 故障后刷新恢复、原操作幂等重试；只在服务端接纳后显示已加入。
设置或目标版本冲突保留原请求，用户查看最新状态后再确认，不自动将旧操作套到新状态。
已会声明及撤销独立保存，影响待学候选，不改写材料或产生学习完成/FSRS。

## 代码与持久化

- `consumer/target.ts`：目录候选、TargetView、加入/重试准备/已会声明合同。
- `curriculum/targets.ts`：所有权与稳定身份校验、规范 Target 映射、来源与成员、材料准备。
- `0012_sensa_consumer_curriculum.sql`：复用既有 Retention/Learning Target 和 Materialization，
  新建 canonical mapping、成员、来源、准备计划、已会声明、已发布候选和媒体元数据。
  兼容 workspace 仅由服务端 LearnerScope 生成；不暴露为产品功能，不改写旧学习事实。
- `media/consumer.ts`：服务端 private Storage 读取适配。请求先校验账号/材料所有权，离开
  数据库事务后读取媒体，再校验字节数和 SHA-256。浏览器用 Blob 试听，不得到服务端密钥。
- `TargetLibrary.tsx`：目录、详情、加入/恢复、准备状态和音频检查，复用原 React 外壳。
- IndexedDB v3 增量保存 Target 投影和目录缓存；数量/目标操作共用逐操作账本和提交序 feed。
  新 bootstrap 返回 plan+targets，旧账号队列仍保留；没有覆盖旧 Sync v1/v2。

补充 `Lightweight Initial Content Demand v1` 的 published 路径，兑现已确认的 published /
on-demand / hybrid 供给边界；所有角色、校验和固定材料规则保持。

## 真实模型与音频试验

Owner 本轮先授权 Google 免费层级，检查发现 Gemini CLI 有 OAuth 配置，但 API key 为空；
随后明确改用现有 DeepSeek API，并允许 edge-tts。因此执行了**一次小样本生成任务**，
不是给日常测试打开无限付费调用。

- 模型：`deepseek-v4-flash`，2 个模型回合、1 次已批准工具调用。
- Provider 返回用量：输入 8,934 tokens，输出 5,100 tokens；没有查询账单或估算实际金额。
- 样本：tactful 的固定意思；生成场景、回想支持、例句等，经过既有材料/角色/不泄露答案
  校验，主代理检查本轮生成文本与指定意思一致。工具引用是既有 live smoke 的合成参考夹具，
  因此不把它声称为已完成真实词典/语料溯源的生产内容。
- edge-tts：`en-US-JennyNeural`，tactful 发音，9,936 bytes，约 1.66 秒。
- 生成 JSON 保存在 ignored `content/data/consumer-generations/tactful-trial.json`，音频在
  `/tmp/sensa-m1b-tactful.mp3`。生成内容和二进制不提交 Git。
- 该真实输出加上音频已进入**隔离数据库夹具**，跑通准备校验、受权材料读取和浏览器试听。
  没有把合成身份/审核记录写入真实用户库，未发布生产目录。

已有 live smoke 增加显式 `SENSA_SAVE_CONTENT_TRIAL=1` 输出选项；只有主动运行
`sensa:content-agent-live-smoke` 才调用 DeepSeek。常规构建、CI 和回归不调用模型/TTS。
本轮没有把 HTTP 加入请求接成自动 LLM 调用。自动按需生成仍按 M2 持久任务/Attempt/预算
与独立校验边界落地；M1-B 读取发布前已固定的材料，不能以本次试验冒充线上按需生成已完成。

## 验证证据

- 在全新 loopback 隔离库顺序应用 12 个迁移，并加载只用于测试的稳定身份/内容夹具。
- Node/Deno 使用受限 backend_app 身份：目录分页、详情只读、重复来源同一个 Target、
  无效 Binding/Source、过期 scope、准备失败仍有成员、不可重试状态拒绝重试、事务账本
  故障导致 Target/成员/材料/feed 一起回滚、bootstrap/feed 恢复。
- 已会声明和撤销改变候选，不创建新 Target、不改固定材料；已有声明时重复加入仍被拒绝。
- 私有 JSON 和音频：其他账号一律无法读取；媒体不可用返回可重试错误，不返回假音频；
  可用音频核对字节数/摘要，浏览器实际解码。媒体索引暂不可见时进入 blocked，恢复后重试
  使用同一成员/准备计划转为 ready，不重复创建目标。
- Chromium：M1-A 恢复流程回归；M1-B 目录→详情→离线加入→刷新→联网重试→就绪→
  材料读取/试听→已会与撤销→回首页。390×844 和 1280×800 观察，无页面异常。
- 根级 typecheck/build/lint；Edge check；既有 Web UI、Sync、Learning Content 和
  Extensibility 合同 smoke。lint 仍为类型检查。CI 文件新增无付费的目录夹具加载。

正常本地集成使用 `SENSA_TEST_DATABASE_URL` 指向 `sensa_m1a_` 前缀的 loopback 隔离库。
`node --import tsx scripts/support/consumerTargetFixture.mts --write` 输出测试 SQL 至 `/tmp`，
需以隔离库迁移身份应用。默认使用确定性文字夹具，无 API 费用。
`SENSA_USE_GENERATED_TRIAL=1` 只复用已有 ignored DeepSeek JSON 和 `/tmp` 音频，不再调用模型。
浏览器复现沿用 M1-A 夹具服务，设置 `SENSA_TEST_CURRICULUM=1`，有真实试验音频时再加
`SENSA_TEST_AUDIO=1`。截图在 `/tmp/sensa-m1a-browser/target-ready-mobile.png`。

## 已知边界与下一条

- Supabase Auth、private Storage 对象上传/读取及 Edge 托管验证仍待配置并通过 CI 执行。
  本地使用真实 Postgres、合成 Auth 服务和受控本机媒体 reader；不能称为公网验收。
  Storage 下载适配依据 [官方 private bucket 文档](https://supabase.com/docs/guides/storage/serving/downloads)。
- 目录当前仅从受控发布表读取。没有通用生产内容发布 CLI，也未导入正式审核样本库。
  `scripts/support/consumerTargetFixture.mts` 是故障夹具，不能用于生产发布。
- bootstrap 目前支持最多 500 个 Target 的有界完整快照，超限明确拒绝且保留旧副本。
  大规模分页快照与分页学习清单待补；不声称完整 M0-3 Sync 合同已验收。
- 静态内容校验可在加入事务内完成，没有后台耗时生成。媒体元数据尚缺失时可重试准备；
  将来生成任务不能照此在数据库事务内等待模型/上传。
- 已会声明目前还没有 Run；M1-C 加入未结算回答后，须补 pending_result 门，不能直接复用
  本轮无 Run 的前提。准备态与首页计数也须随 Runtime 接上真实开始/跨日配额。
- CSS gzip 约 119.66 KiB，仍超过初始 100 KiB 预算；未宣称性能门通过。

下一条 M1-C：从首页创建受权 Run，完成回想→揭示→自评→服务端结果确认，落一次 Completion、
Scheduling Handoff 与 FSRS 初始化，并覆盖离线续学、丢响应、额度竞争和幂等恢复。
