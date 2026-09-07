# M0-3：M1 施工任务与合同验收

> 日期：2026-09-07；状态：设计交付；M1-A 本地实施与验证见 [交付记录](m1-a-account-handoff.md)
> [消费合同](m0-3-consumer-contract.md)固定接口行为；[迁移蓝图](m0-3-migration-blueprint.md)固定所有权。
> 本表细化现有[路线图](production-migration-plan.md)的M1，不新增平行里程碑。

## 1. 实施分工与共用约束

所有任务仓库为 `/Users/shadow/sensa-standalone`。2026-09-07 owner 修订：后续不再使用
worker 模式，由主代理直接承担设计、实现、审查与验证，已允许浏览器测试。旧 worker
分工由此覆盖，模块边界和验收条件继续适用；不创建新工作树，不从本地部署云资源。

共同适用：AGENTS.md、development-workflow、七份领域模型、M0-2两份定稿和本轮两份合同。
不得调用付费LLM/TTS，不部署本地shell，不重构四阶段，不恢复已移除入口；React UI沿用
experience，未来Flutter复用JSON合同。每个任务都要有真实边界验证，不能仅提交类型/空壳。

## 2. 单writer的纵向任务顺序

| 任务 | 用户结果与前置 | 文件所有权（新增路径在蓝图定义） | 验收条件 |
| --- | --- | --- | --- |
| M1-A 登录与数量 | 受邀用户验证码登录→明确确认数量→空首页；前置M0验收记录 | contracts/sensa/consumer的envelope/account/plan；API auth/access/curriculum、environment/requestContext/app；Web application/data consumer/replica和原账号/数量页；access/plan/ledger迁移；Supabase Edge入口与CI检查 | L01–L04/A01–A05；拒绝未邀请/撤销；并发登录一Account一Learner；首次默认5不能绕过确认；离线修改落盘；Edge依赖/事务smoke |
| M1-B 目标到就绪 | 首页→目录具体意思→加入→准备→ready回首页；前置A的账号与v3管道 | consumer catalog/target/command；API catalog/curriculum/media；Web LearningEntry/Library/Detail及用例controller；target映射/membership/plan/material迁移 | B01–B06/F01–F05；无PersonalMeaning依赖；重复来源一target；无效binding拒绝；blocked保留成员；私有材料授权；少量固定已审核内容 |
| M1-C 首学到确认 | 首页开始→回想→揭示→自评→结果确认→再次进入；前置B ready | consumer runtime/result/sync；API runtime/scheduling/sync v3；纯kernel轻量policy；Web轻量首学controller/IndexedDB恢复；run/action/completion/memory/feed迁移 | C01–C07；again回想，hard/good完成；离线只继续已授权Run；保存失败不前进；丢响应不重复Completion/Handoff/FSRS；两设备最后一个额度只开一个新target |
| M1-D 到期复习与重学 | 到期→一次自评→10分钟穿插→恢复/结束→回来继续；前置C memory | consumer review/relearning/activity summary；API runtime/planner/scheduling；Web轻量review controller/summary；relearning/activity索引 | C08–C11/R01–R06；Review一次Outcome/FSRS；提前继续显式；刷新不重计时；重学不二次改调度；等待不阻止其他目标 |
| M1-E 签到与恢复验收 | 开始学习自动签到、手动签到、离线重连、再次进入；前置A/C，汇总接D | consumer checkin；API activity；Web StudyScreen/日历及本机队列；checkin迁移；上述切片集成smoke与发布工作流 | K01–K03；一个账号日一次；失败签到不回滚学习；跨日按可信发生日期；旧账号pending不串号；完整M1链可复现 |

表内 `contracts/sensa/consumer` 指 `packages/contracts/src/sensa/consumer`；API/Web均指
对应apps下src。每个任务可修改自己的相关根package scripts/共享index与测试入口，但这些
共享修改串行交接给下一任务；不得并行争用。若拆为多个writer，必须另行列出不重叠所有权。

M1-A先建立最小v3 envelope/ledger/replica，后续任务增补已定kind的实现而不改变wire语义；
未实现kind明确unsupported，不假成功。迁移与consumer实现按切片同时提交，CI先校验旧/新
兼容，再在隔离环境迁移。部署仍走CI/CD；实际云端凭据不可用时交付本机证据并标明公网门
未通过，不把缺凭据反推成要重新设计用户体验。

## 3. 合同场景向量（实施时转为 targeted smoke）

ID是设计向量，不是已经运行的新测试。A/B是安装，L是学习者，S是同一稳定Sense，E是binding。
所有时间由测试clock控制；不让测试等待真实10分钟。每个向量同时断言返回值与数据库事实。

| ID | 输入/故障 | 必须观察到的结果 |
| --- | --- | --- |
| V01 | L未确认数量，尝试C05；随后C01数量5重复投递 | 首次拒绝onboarding_required；一份计划、一次确认；重放返回原结果 |
| V02 | A/B同时把最后一个新学额度用于不同target | 只允许一个创建initial Run；另一个返回daily_limit；继续已开Run不再占额 |
| V03 | 已开始3项，limit从5降为2，再升为10 | remaining依次0、7；三项Run与固定材料不变；第二天继续不重新扣额 |
| V04 | 同L/S/E从catalog与book条目同时加入 | 一个retention、一个有效成员/覆盖结果；保留合法provenance；不同binding不合并；无隐式PersonalMeaning |
| V05 | 无效target且已有成员，或已声明已会再加入 | 先验证target/policy/声明，再判断already_in_scope；不能借重复加入绕过无效输入 |
| V06 | 目录材料校验失败/必需音频缺失 | 成员仍在，readiness blocked/media_missing；无Run/额度扣减；只有retryAllowed能重试 |
| V07 | 同operation发送两次/第二次改rating | 原文重放同结果；改文拒operation_id_reuse；不同新operation对旧Step返回stale_step |
| V08 | 终步response丢失；客户端刷新查结果再push | 一Completion、一handoff、一FSRS初始化；本机pending在知晓原结果后清除，不重答 |
| V09 | completion后写SchedulingDecision时注入错误 | Attempt/transition/completion/feed/result全部回滚；重放可一次完成，不留半个成功 |
| V10 | A/B对同due identity分别good/again | 一个有效Outcome和一次memory revision增长；另一个冲突保留输入，不自动套到新Review |
| V11 | 12:00 again，12:04其他项做完；12:10再出现 | 12:04显示6分钟等待，可结束/提前；刷新不改nextEligibleAt；恢复后再次again改为新10分钟 |
| V12 | Review again已落盘未结算，断网尝试新Relearning Run | 不新建Run；只保留需要/pending和合法其他学习；原Outcome结算后在线授权才启动重学 |
| V13 | 同已授权Run离线reveal→rate，多Step连锁，再联机 | 本机原子保存，服务器按固定协议/revision/dependency重放；前驱冲突后继保留不rebased；无客户端Completion事实 |
| V14 | bootstrap中断、cursor过期、晚提交事务 | 半份快照不替换当前投影；outbox保留；feed按提交序完整，无晚事务被cursor跳过 |
| V15 | A退出后B登录，原A pending及grant仍存在 | 不上传到B、不显示A私人材料；切回A合法身份再恢复；撤销/删除优先拒绝 |
| V16 | grant过期、设备时钟倒退、断网重启 | 保留输入与可解释状态，不假接纳、不以收到时间改签到日期；有效授权内迟上传按时间校验处理 |
| V17 | 手动签到与两设备进入正式Run同一天 | 一天一条checkin，formal有真实Run入口引用；浏览、解析、失败start不签到；不产生Evidence |
| V18 | 重学成功且原Review完成，另一个结果pending | review去重数不因重学重复增加，等待是needsRecall子集；pending单列，不能说全部完成 |
| V19 | v2旧outbox发到v3；旧Learner多个candidate映射 | upgrade/version拒绝并保留原载荷；迁移歧义隔离；不自动清库/重置/选第一行 |
| V20 | 未受邀有效JWT、错误issuer/audience、revoked session | 不读写私人scope；JWT认证与Sensa准入都必须通过；业务表无客户端直接写权限 |

M1 smoke覆盖V01–V20的关键事务与消费；M3扩展真实双设备/删除/中断恢复，M4再验收公网
邮件、商店、实际性能。M1不能因为M3另有深入测试就跳过本条链的数据完整性检查。

## 4. 验收预算与测试条件

M0-2的用户界面门保留：按钮反馈100ms内、缓存页面p95≤200ms、移动LCP≤2.5s、CLS≤0.1、
INP≤200ms。M1记录构建hash、Chrome稳定版确切版本、测试机CPU/内存/OS与网络配置；开发
对比采用390×844和1280×800两viewport，移动实验网络往返150ms/下载1.6Mbps/上传750Kbps，
CPU 4倍减速，至少20次冷加载和50次缓存页面转换；实验交互耗时不能冒充真实用户INP。
M4补实际手机及字段指标或可复现交互证据，未经测量不能标达标。

初始资源工程预算：正式首页入口JS压缩≤300KiB、CSS压缩≤100KiB；媒体按需加载且不计入
首页必需下载；任何超预算须用实测解释并优化或记录修订理由，不通过改阈值掩盖回退。
当前已有Web约615kB gzip JS，是待拆分基线，不是M0-3已做优化。插件解释网络耗时单独测，
不计为本机浮层反馈；受邀版记录provider调用量/失败/耗时与每日预算，禁止盲目无限重试。

API工程预算：有界push≤50项、body≤256KiB、pull页≤500项；Edge每请求CPU按官方限制验证，
不预承诺所有50项在2秒内。若实测过限先缩小批量/分开应用请求，仍维持单操作事务，客户端
不得因批次拆分生成新operationId。长生成任务M2持久task+独立attempt，不使用HTTP等待持久性。

## 5. M0-3 退出核对

| 门 | 产物 | 证据类别 |
| --- | --- | --- |
| 已确认体验映射 | consumer第3–7节→M0-2 A/B/C/F/R/L/K，插件需求第10节 | 设计审阅，不是UI运行 |
| Query/Command/Projection/error/revision/Sync | consumer第2–8节，11个kind、8组Query、显式v3 | 文档合同，M1生成可执行schema |
| Target v2/旧SQL/旧Sync迁移裁决 | migration第1/3/4节，canonical映射和历史隔离 | 代码与SQL静态核查，没有真实数据迁移 |
| 全局目录和数据所有权 | migration第2/3节与consumer第9节 | 架构设计，目标目录未全创建 |
| 第一条可执行任务 | M1-A–E及V01–V20、验证条件 | 实施输入，尚未派发 |
| 基础检查与事实校验 | 根级typecheck/build/lint、已有v2/Sync协议smoke、文档检查 | 只证明现有代码基线与文档可交付，不证明新API已实现 |

完成上述设计与检查后将M0-3标记“已验收：设计合同”，M0标记基线/合同设计已验收，下一步
M1-A。没有新增待owner裁决的产品流程；工程数值和适配检查点由supervisor负责，影响体验或
需要迁移真实历史数据时必须按既有安全/确认流程处理。M1–M5不随M0状态推进。

## 6. 本轮交付记录

2026-09-07，在原工作树完成三份M0-3设计文档，同步索引、阶段、路线图与开发工作约定。
没有修改源码/SQL/运行配置，没有执行迁移、部署、浏览器操作或付费模型/音频调用；
未新建Git提交。M0-3与M0设计门已按第5节核对完成，下一任务为M1-A。

验证结果：

- `npm run typecheck`、`npm run build`、`npm run lint` 均通过（lint当前复用typecheck）。
- `npm run sensa:extensibility-contract-smoke`、`npm run sensa:sync-protocol-smoke` 通过；
  检查的是既有v2领域合同与旧Sync基础，不是尚未实现的v3运行闭环。
- 72个相关文档相对链接、11个Command与8组Query编号、20个验收向量编号、JSON示例解析、
  文档whitespace与`git diff --check`通过；共同类型代码块抽取后通过独立TypeScript语法/类型检查。
  这不替代M1的完整JSON Schema与跨语言canonicalizer向量验证。
- 构建仍有既有大chunk提示；没有首屏/公网/跨设备实测，不能标记生产性能已达标。
