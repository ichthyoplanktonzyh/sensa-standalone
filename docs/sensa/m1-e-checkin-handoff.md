# M1-E：签到与恢复验收交付记录

> 2026-09-08；A–E 本地纵切已串联验证，真实 Supabase 托管验收仍待执行。\
> 前序 D checkpoint：`428cfc9b`。

“我的学习”提供手动签到和日历；实际进入已授权、材料已下载且可作答的正式学习也触发
独立签到。同一账号日只记录一次，按账号时区确定日期，先被接受的来源保持不变。
创建 Run、展示结果待确认或冲突恢复页本身不触发签到。没有连续天数、奖励或补签。

签到先写入账号自己的 IndexedDB/outbox，界面区分已确认和待同步。签到失败不阻止开始、
继续或结算学习，也不产生 Evidence、Memory Outcome、FSRS 或额外学习进度。
离线记录重连后仍按可信发生日期入账；时间无法确认时保留原请求，提示联网后重新确认，
不把旧记录改成上传当天。切换账号清空旧界面投影并忽略旧账号异步回写，原 pending
仍只属于原账号，返回该账号后继续处理。

## 实现与合同细化

- migration 0015 增加账号时钟授权、独立 checkins 与账号日唯一约束；Run 授权绑定实际
  start/next 操作身份。新表只授予后端读取/新增权限，不开放匿名或直接客户端写入。
- 登录初始化接受当前页面 clockSessionId，返回 7 天有效的 account clock grant。手动签到
  引用该 grant；自动签到引用 Run grant 和已被接受的进入操作。服务器检查账号、安装、
  replica、scopeEpoch、页面时钟、期限和发生时间，登录/受邀撤销仍在同步入口拒绝。
- 客户端时钟校准只保留在页面内存，用单调时间推导发生时间。页面刷新不复用旧校准，
  本机时钟明显跳变后停止信任该 grant；这与 C 的离线作答范围一致。
- C11 的可执行 payload 增加 clock，结果为 `{plan,checkin,alreadyRecorded}`。
  Q08 当前返回最新最多 366 条 CheckInView，Web 日历开放当前月及前 11 个月；
  bootstrap/home/feed 同步同一投影。具体 schema 位于 consumer/checkin.ts。
- 签到操作独立事务；临时失败返回单条 retryable，同批后续学习仍可执行。
  Web 每轮只尝试一次失败项，并继续处理其他操作，后续同步再重试。
- CI 增加 E 的 Node/Deno 事务验证和完整生产构建浏览器流程。浏览器使用本地合成 OTP/JWT
  与隔离 Postgres；测试专用时间、故障、撤销接口只在 smoke harness 中，不进入生产 API。

## 验证证据

在全新隔离数据库 sensa_m1a_e_final 顺序应用 0001–0015，装载确定性目录材料。
Node 的 `npm run sensa:consumer-checkin-smoke` 与同脚本 Deno 的
`--targets --initial --retention --checkin` 均通过完整 A–E：

- A/B/C/D 既有身份、准备、首学、复习与重学事务回归；
- 同账号两安装并发签到、原操作重放、同日不重复和来源保持；
- Run 创建不签到、伪造进入操作被拒绝、实际进入后独立接受；
- 签到插入故障不回滚同批学习回答，之后可重试；
- 跨日迟上传按原日期、空/错页面/错时间校准拒绝、旧 epoch、账号隔离和撤销拒绝；
- 签到不新增 Memory Outcome。

Chromium 的完整 A–E 生产构建流程通过，含已有缓存音频：
实际学习自动签到、日历、离线跨日补传、Session 撤销后的登录门、A/B 独立账号切换与原账号
pending 恢复，以及签到持续失败期间仍可加入目标、开始并完成首学。
C/D 的本机保存失败、断网、多步回答、丢响应重放、复习与 10 分钟重学同时回归。

浏览器为 Chrome for Testing 149.0.7827.55，390×844 / 1280×800；Node/Deno 本地运行。
根级 typecheck、配置合成登录环境的 production build、lint、Edge check、既有 Sync 协议与
轻量 Runtime smoke 均通过。测试复用已有 DeepSeek/edge-tts 样本，无新增模型或 TTS 调用。

## 后续验收边界

M1 的 A–E 本地施工已完成；不能据此将整个 M1 标为生产验收完成。
真实 Supabase Auth/邮件送达、托管 Postgres/Edge/Storage、远程 CI、公网和实际设备性能
仍需在配置齐备后通过 CI/CD 验证。本次没有推送或部署。
C 的有界快照及应用壳离线冷启动限制仍适用；日历首版仅开放上述 12 个月范围。
正式 Web 入口加 AccountRoot gzip 约 246 kB，CSS 119.66 kB；CSS 仍超出初始预算，
没有真实性能达标结论。后续产品施工进入 M2 插件采集与个人语义闭环，云端验收缺口继续单列。
