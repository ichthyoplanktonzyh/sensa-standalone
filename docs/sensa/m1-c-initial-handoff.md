# M1-C：首学与结果确认交付记录

> 日期：2026-09-07；范围：本地端到端纵切。Supabase 托管与公网验收尚未执行。
> 依据：M0-2 首学状态、M0-3 消费合同与施工表；在原工作树由主代理直接实施。

## 用户结果

首页在线开始一次已就绪目标的首次学习，依次回想、查看表达和自评。
“没想起”生成新的回想步骤；“有点困难”和“想起来了”完成首学。
每一步先原子写入账号专属 IndexedDB 的 outbox 和本机进度，再推进页面。
网络请求尚未返回时即可暂停回首页；再次进入继续同一个 Run，不再占新学数量。
只有收到服务器的 Completion 才显示完成与下次复习时间。

服务器响应丢失时保留原 operationId 和原始回答；检查结果重放原操作，不要求重复作答。
冲突输入保留供查看，用户可明确使用最新进度继续；不会自动把旧回答套到新 Step。
既有目标详情仍通过“回首页”进入学习，已会声明与首次学习结算分开。

## 实现与持久性

- `consumer/runtime.ts` 固定轻量首学协议 `consumer-initial-v1`、Grant、Activity、Run、Action 和完成投影。
  `consumerInitial.ts` 是 Web/API 共用的纯步骤迁移及稳定 Step ID 算法。
- API 在同一 learner 锁下分配账号日新学额度、承诺策略、创建 Run、写步骤与授权。
  数量变更只影响尚未开始的目标，隔日恢复不会重记新学数。
- migration 0013 在私有 `sensa_consumer` 中增加活动、运行、步骤、授权、原始回答、迁移、
  Completion、Scheduling Handoff/Decision 与每个 Retention Target 唯一的 Memory State。
  backend_app 可写，PUBLIC/anon/authenticated 无直接访问权。
- 每个 action 的 Attempt、Transition、终步 Completion、调度、目标/运行投影、feed 与
  幂等结果账本同事务。失败全部回滚；不同设备争用旧 Step 时只有一次有效推进。
- 首学 Completion 明确为 `non_evidentiary`，没有 Memory Outcome 或掌握声明。
  首次初始化固定 FSRS-6、desiredRetention 0.9、空学习/重学步骤、fuzz=false；
  以协议完成映射 Good 初始化一次，目前初始到期为完成时间后 2 天。
  既有采用学习步骤的调度配置保持原行为，并有冻结回归向量。
- bootstrap、pull 与 home 包含权威 Run/Activity；feed 不广播安装专属 Grant。
  材料内容和音频逐一校验 SHA-256 后保存在账号分区，运行期间固定材料版本。

## 离线与时间合同细化

C05/C07 增加必填 `clockSessionId`；C06 增加 `clock:{sessionId,elapsedMs}`，本切片在线和
离线回答均使用非空 Grant。Grant 绑定 learner、安装、replica、epoch、Run、协议、材料、
baseRevision 和页面时钟会话，有效期 7 天。C05/C07 响应以当前服务器时间建立单调时钟基准；
重放旧响应不会重新开始授权有效期。刷新后旧时钟基准不复用，需联网恢复获取新授权。墙钟与单调时钟明显偏离时也要求重新校准，
墙钟只用作漂移探测，不直接作为回答的权威时间。

服务器检查发生时间与校准时间、授权有效期、单调顺序和未来容差；Run 上也记录最近回答时间，
防止跨 Grant 回退。有效窗口内发生、窗口后才上传的回答仍可接纳。未知或不可信时间保留输入，
不改用接收时间补造学习发生时间。离线只继续已有授权且材料已下载的 Run，不能新建。

C05–C09 的本地可执行返回统一为 `{plan,runtime:{activity,run,reason,summary?}}`；
Activity 含自己的 revision。此为原设计返回字段的结构化落地，并未增加客户端结算权限。
通用 MaterializationManifest 暂沿用 B 的固定轻量 schema 与内容/媒体 digest；
`review_only` 及提前重学仍明确拒绝，等待 M1-D 实现。

## 验证证据

- 新建隔离 PostgreSQL 库 `sensa_m1a_c_final`，从 0001 到 0013 共 13 个迁移全部执行，
  使用受限 backend_app 继承角色运行；未修改真实用户数据库。
- `npm run sensa:consumer-initial-smoke`：账号/目标既有回归，加上首次设置门、策略运行、
  Grant/安装/材料/时间校验、again 新步骤、两安装终步竞争、SchedulingDecision 故障回滚、
  Completion/Handoff/Memory 唯一、最后一个每日额度并发、隔日继续、迟上传、暂停/结束与私有 feed。
- 同一脚本在 Deno 中运行；`npm run sensa:edge-check` 校验 Supabase Edge 依赖。
- `sensa:consumer-browser-smoke` 加 `SENSA_TEST_CURRICULUM=1 SENSA_TEST_AUDIO=1 SENSA_TEST_INITIAL=1`：
  Chromium 分别在开发服务与配置了本地测试登录服务的生产构建预览中执行验证码、数量、目标加入、首学；验证答案揭示边界、IDB 写入故障不推进、
  离线多步、网络未返回即可暂停、再次进入、刷新时间门、私有音频解码、终步响应丢失与结果重放。
  视口 390×844 / 1280×800，Chrome for Testing 149.0.7827.55，
  Darwin 25.6.0 / arm64 / Apple M1 Max / 32 GiB；本轮无网络/CPU性能模拟。截图位于 `/tmp/sensa-m1a-browser/`。
- 根级 `npm run typecheck`、生产模式 `npm run build`、`npm run lint`；
  既有 `sensa:sync-protocol-smoke`、`sensa:lightweight-runtime-smoke`。
- CI 检查已改为执行首学集成 smoke；本地通过不代表远程 CI 已运行。

无新的 LLM/TTS 调用。浏览器复用 B 已授权生成的 DeepSeek 材料与 edge-tts 音频，
常规数据库/CI 使用确定性的合成材料；这些测试数据不代表生产发布审核。

## 交付边界与下一步

M1-C 本地纵切完成。M1-D 接到期复习、Memory Outcome 和 10 分钟穿插重学；M1-E 接签到。
本切片完成信息是真实首学结算，不能宣称整个 M1 或生产发布已完成。

Supabase 真实账号邮件、托管 PostgreSQL/Storage、云部署、公网网络条件和真实性能门仍待验证。
完整离线冷启动应用壳缓存不在本切片；当前覆盖已打开页面的离线运行，以及应用壳能加载时
刷新后的输入保留与联网恢复。bootstrap 延用最多 500 个目标/Run 的有界完整快照，超限明确拒绝。

配置了测试登录服务的正式 Web 构建报告：入口 JS gzip 123.76 kB，AccountRoot 119.26 kB，
合计约 243 kB；CSS 119.66 kB，
超过最初 100 KiB 预算，延续 B 的待优化项。未配置登录服务的构建会裁去部分不可达 UI，
不能用其较小的 AccountRoot 大小代表真实登录路径。CI 已加入合成登录配置以检查完整路径。没有以本次功能 smoke 宣称延迟、LCP 或 INP 达标。

本次配置构建标识：`index-KBZbyC5z.js`、`AccountRoot-Dbx1v5_R.js`；这些产物只用于本地检查。
