# Sensa 生产化路线图

2026-09-08 原生增量：轻量到期复习与再学习已接入 Rust/SQLite/Flutter，事务和平台验证见 [交付记录](native-retention-handoff.md)。通用 Progression Kernel 与策略组合引用校验的纯接口随后已迁移并接入原生组合入口，见 [进度内核记录](native-progression-handoff.md)。这些记录不将正式 Activity/Mixed/去重汇总、完整 Runtime 编排或完整 LF-1b 标记为完成。 Policy Assignment、purpose plan/readiness 与首次 Run 固定已继续接入，见 [策略迁移记录](native-policy-handoff.md)；完整模式执行与 Policy Migration 仍待完成。 通用进度账本随后已接入原生 consumer，见 [账本记录](native-progress-journal-handoff.md)，不代表多阶段执行器已交付。 四阶段纯编排与恢复格式已继续迁移，见 [四阶段记录](native-four-stage-orchestration-handoff.md)，正式材料、评价、事务适配与 Flutter 呈现仍是开放前置。

2026-09-08 Owner 范围调整：四阶段只作扩展性测试，正式材料/UI 暂停；高保证是当前优先迁移对象。
高保证 fresh/repair 选择器与首学队列纯生命周期已迁移，见 [选择器记录](native-assurance-orchestration-handoff.md)及[生命周期记录](native-assurance-lifecycle-handoff.md)。复习/重学纯队列与 effect 对照已完成，见 [复习队列记录](native-assurance-review-handoff.md)。2026-09-09 材料、评价、原生事务和 Flutter 界面已贯通，Profile 执行接线已验收，见 [完整纵切记录](native-assurance-integration-handoff.md)；完整产品迁移与 M3 仍保留。

2026-09-09 学习组织增量：Activity/Mixed、Review-only、每日 Introduction 计数、独立签到和近期学习记录/去重汇总已接入本地学习主链，见 [活动纵切记录](native-activity-integration-handoff.md)。完整 Curriculum/范围选择、正式产品 IA、Policy Migration 与其余迁移仍保留；不据此关闭 LF-1b 或 M3。

2026-09-09 个人语义世界增量：已有本机 Sense 的文本快轨/收件箱、独立接受、移除恢复和显式入学已贯通，见 [交付记录](native-personal-world-handoff.md)。在线语义解析/澄清与本地新 Sense 接受已在 [后续纵切](native-semantic-resolution-handoff.md) 接入；下一项为显式入学与按需内容任务/冻结材料化。完整多模态、图谱及其余迁移不因此关闭。

> 状态：Active roadmap\
> 更新日期：2026-09-07\
> 近期目标：Flutter/Rust 原生单设备本地学习库；Web 保留成果、暂停新建设\
> 当前工作：本地底座 LF-1b 的 Flutter/Rust/SQLite 首学技术纵切；M1/M2 保留为迁移回归基础\
> 阶段与范围：[current-stage.md](current-stage.md)

## 1. 路线图职责与交付原则

2026-09-08 方向变更：[完整本地学习库与可选加密同步决策](../adr/0001-local-library-optional-encrypted-sync.md)已接受。
继续扩展服务器权威方案或进入托管交付前，应先完成本地领域执行、加密同步、在线服务数据边界和
旧数据迁移设计，再重排受影响的里程碑。下面既有 M0–M5 任务和证据保留为迁移基础，不能直接
计为新架构验收；原生优先顺序已确定，具体同步协议与密钥恢复方案仍待设计。现已启动下述本地底座迁移，未切换用户数据。

本文件接替原先的剩余迁移事项清单，统一管理从领域/行为原型到生产闭环、受邀测试和后续
扩展的推进顺序。领域文档裁决身份与不变量，PRD 裁决产品 IA，current-stage.md 裁决当前
范围；本文件裁决阶段依赖、交付物与退出条件。不另建并行的生产路线图。
设计、前端确认、蓝图精度、worker 分工与流程调整遵守
[开发工作约定](development-workflow.md)。工作方式可以根据实际交付反馈修订。

当前复用基础包括旧 React Web/API/Postgres/Sync 本地纵切、最新 web-next 行为原型、共享
schema/Kernel、内容工具与 smoke。每项资产在接入生产前均须按当前模型审查；已有文件、页面、
表或适配器只计为基础，不能直接计为生产完成。

- 每次推进一条可验证的用户用例，同时处理它需要的正式 UI、消费契约、服务端、存储与同步。
  不先铺完所有页面或全部数据库，再开始集成。
- 每个具体用例由 owner 与指定 supervisor/worker 先确认前端布局、功能及关键状态，再细化
  消费契约并开始正式实现；已有后端和旧 schema 不决定产品工作流。
- 以下为保留的旧 Web 交付基线（已被原生优先顺序取代）：首轮 React Web 优先，以 lightweight 建立生产学习链。浏览器采集插件、个人语义与按需
  内容都是受邀测试必交能力；2026-09-07 允许自由练习、词典、统计、签到首发开放，
  按真实能力验收，不自动扩展全部活动/资源。高保证、完整扩展与 Flutter 仍后置。
  签到和练习不写正式 Evidence、进度或调度；真实语流 YouGlish 保留。
- 在真实用户数据进入前，可以按明确方案重建原型/first-user 测试数据。进入受邀测试后，
  不得以该例外删除用户历史或待同步工作。
- 阶段验收以可重现结果和证据为准，不使用按文件数推算的百分比。未确定人员投入前不承诺
  日历日期；在任务拆分与依赖明确后补估时。

## 本地底座迁移：当前优先施工顺序

2026-09-08 Owner 同意推进下一阶段。沿用 M1/M2 的已确认学习与采集体验，先完成
[本地学习库迁移蓝图](local-library-migration-blueprint.md)中的单设备链，再进入多设备及交付。
已有 Web 功能与学习内核扩展机制均须完整迁移；[迁移清单](native-migration-checklist.md)逐项登记，分批交付不裁剪范围。同步优先原生多设备，暂不建设 WASM/Web 互通。
以下 LF 编号是本路线图中跨 M1–M3 的迁移工作包，不是新增产品领域或替代 M0–M5 的另一套路线图。

| 工作包 | 退出结果 | 状态/依赖 |
| --- | --- | --- |
| LF-0 实施蓝图 | 本地库/领域执行/存储/在线服务职责、迁移回退与第一条用例边界可施工 | 蓝图已落文；新增库/备份 UI 及同步细节随对应工作包确认 |
| LF-1a 共用结算规则 | 当前 API 消费平台无关结算；Node/浏览器结果一致，旧事务回归无变化 | [本轮提取与验证已通过](local-settlement-handoff.md)；不是产品离线验收 |
| LF-1b 单设备学习库 | 无在线账号，导入合格资料、显式入学、初学/复习/重学本机原子结算、重启继续；多标签页/失败/重复提交有证据 | 进行中：Flutter/Rust/SQLite 合成材料首学技术纵切；macOS/Android 首学与独立进程恢复已验证。有界文本包导入与多目标首学已接入，macOS/Android 流程与恢复已验证；完整正式 UI、一般发布包/媒体及复习/重学仍待实施 |
| LF-1c 宿主持久与备份 | 应用外壳断网冷启动、必要材料/媒体、配额失败、完整导出/恢复；据实确认 Web/Flutter 后续交付顺序 | LF-1b；浏览器 offline 已打开页面不替代此验收 |
| LF-2 个人语义与浏览器交接 | Capture → 本地待处理/Acceptance → 显式入学；在线候选返回本地固定，原队列恢复且不跨库 | LF-1；保持 Context/Sense/Expression 与快慢轨，LLM 不是保存权威 |
| LF-3 可选加密同步 | 明确密钥与恢复合同、事件合并/调度冲突；两设备离线学习、乱序重试、新设备恢复及订阅停止后本地继续 | LF-1/2；先完成同步设计门，再实施；目前未实现 E2EE |
| LF-4 旧数据切换 | 快照/增量/待提交操作迁移，数量与引用核对，备份、无双写切换和不丢新事实的回退演练 | 单设备可用后可先做只读盘点；切换依赖对应能力验收 |

旧 M3 的恢复与数据控制验收按上述本地权威重新实施。M4 的账号/云端资源/同步/商店发布仍需
具体交付授权，但不能再要求用户登录或依赖托管 API 才能使用本地学习库。
浏览器体验优化清单继续暂停；本轮无付费调用、推送、部署或 owner 数据迁移。

## 2. 里程碑总表

| 阶段 | 结果 | 前置条件 | 当前状态 |
| --- | --- | --- | --- |
| M0 生产交付基线 | 首发页面/状态、插件交接、迁移边界与第一条消费契约可直接指导实现 | 当前评估与路线图 | 设计已验收；M0-1/2/3 已完成 |
| M1 首条生产学习闭环 | 真实账号选择已发布目标，完成轻量首学并进入 Review/Relearning | M0 验收 | M1-A/B/C/D/E 本地纵切已验证，生产验收待执行 |
| M2 采集、个人语义与按需内容 | 浏览器/Web 捕获经确认、加入学习和内容准备进入同一生产学习链 | M1 的 Target/Runtime seam 稳定 | M2-A/B 与 C 文本入学纵切本地已验证；Web 澄清/移除恢复已验证；D 原账号/版本及原生权限恢复已有本地证据；原文授权/撤销已验证；静态音频本地已验证；Chrome 151/152、进程恢复及有限质量抽查已验证；真实托管/商店验收待完成 |
| M3 连续使用与数据控制 | 跨日、跨设备、断网/失败恢复和导出/删除均有验收证据 | M1、M2 接通 | 待执行 |
| M4 受邀测试发布 | CI/CD 环境、真实云端依赖、监控、恢复与公网 smoke 达标 | M3 + 云端准备完成 | 待执行 |
| M5 用户验证与迭代 | 用真实使用、内容质量、可靠性和成本决定下一轮投入 | M4 验收后招募测试用户 | 待执行 |

M1 可以先通过 CI 建立开发/内部集成环境；资源、secrets、迁移流水线和 telemetry 从 M1 起
随用例建设，不能全部拖到 M4。M4 是完整上线验收门。M2 的交互与合同发现、云端运行准备可以
在相关 seam 明确后交错推进，但不得跳过前序验收或让未完成分支进入受邀发布。

## 3. M0：生产交付基线与首条消费契约

**目标**：工程可以按明确的页面意图和领域规则实施首条生产闭环，不需要从 mock 副作用猜业务。

交付物：

1. 首轮功能/入口清单：将 current-stage.md 的受邀测试范围逐项映射到页面、操作、资源条件与
   unavailable 状态。保留两条独立主旅程；确认首轮开放项及后续项的隐藏/禁用规则。
2. 正式 React Web IA 与首条旅程设计：以 PRD 和已冻结行为为输入，明确首页、选目标、学习、
   完成/复习及账号/同步入口；适配桌面和手机浏览器。形成首批设计 token、组件及交互状态规格，
   后续用例再逐步扩展。不把原型 CSS、组件树或导航直接固化为生产合同。
3. 页面状态矩阵：覆盖 loading/empty/preparing/ready/blocked/pending/offline/conflict/retry，
   以及刷新、离开、取消和恢复。区分本机呈现状态、可乐观预览的意图与服务端权威事实。
4. 首条用例消费合同：明确 Query/Command、Projection、operation identity、expected revision、
   accepted/replayed/conflict/unavailable/error，以及版本、授权、幂等和恢复规则。合同按用例命名，
   不照抄数据库 CRUD；先完整覆盖 M1，M2/M3 在各自开工前补齐。
5. 迁移裁决清单：逐项决定 apps/web、API、Kernel、contracts、0008–0010、旧 Sync 与
   web-next 行为的保留/修改/替换方式；解决 Learning Target/Retention Target v2 与旧 SQL 的
   关系差异，明确新 Runtime/Sync 版本和测试数据重建方案。
6. 可实施的结构蓝图：全局模块/目标目录、依赖方向与数据所有权，以及首条已确认用例的
   实际文件职责、共享类型/接口和关键状态、事务及验收规则。普通内部函数由 worker 决定，
   不将全系统最终函数清单作为开工前提。

**退出条件**：owner 已确认首条旅程的界面、功能、关键状态和操作结果，并有对应产物记录；
当前消费合同及结构蓝图足以指导实施；没有未解释的 mock
副作用；合同能供 Web、API 和未来 Flutter 独立实现；首批 UI 规格和迁移选择有可审阅产物。
产品导航或冻结旅程若有实质变化，在同一交付中记录裁决并更新对应基线。

M0 验收后，首条已确认用例进入 M1 的生产集成方式；未确认的后续用例继续按同一状态/合同门
发现需求。无需等完整领域的所有页面设计结束，也不能把本路线图当作消费合同已经完成。

M0-1 的已确认产物是 [首轮产品清单与状态矩阵](first-round-product-baseline.md)，包括九个
能力区及 Web/插件状态；9 月 7 日已同步四类首发允许项，允许开放不等于已生产验收。
[首条登录/学习状态规格](m0-2-first-learning-state-spec.md)是 M0-2 评审产物，
体验规格已确认完成，不是 M0-3 合同或 M1 真实接入。M0-2 同时细化插件捕获、原位确认、收件箱交接及安装更新体验；
M0-3 记录插件身份、Intake、幂等和数据控制需求，完整插件提交合同在 M2 开工前验收。

## 4. M1：首条生产学习闭环

**目标用例**：真实账号登录 → 建立最小 Study Plan → 从已发布 Book/Catalog 选择 stable
Sense + expression binding → 解析轻量计划与材料 → 首次学习 → Scheduling Handoff → 到期
Review → 必要时 Relearning → 再次进入仍可继续。

先用少量已审核内容验证这条链，减少模型生成不确定性。它是工程切片，不删除 M2 的个人语义
首发要求，不将 Published Package 变成所有学习目标的前置条件。

交付物：

- Supabase Auth 认证、Account/Learner 绑定、LearnerScope 授权、当前 Account Session 与访问隔离。
  本地 auth 仅用于受限开发，不计入真实身份验收。
- 新版本 Target、Entry Provenance、Policy Assignment/Effective/Committed Policy、Resolved
  Learning Plan/readiness、Materialization、Protocol Run/Step Instance、Observation/Transition、
  Completion/Handoff 与 Memory Outcome/Scheduling 持久化和服务端用例。
- 按最新合同迁移数据库与 Sync；用数据库事务和唯一约束保护身份、版本、Completion/Handoff
  和调度幂等。schema、运行合同、迁移与回滚/重建说明随代码一起交付。
- 服务端 Unified Planner 拥有每日新学数量、去重和 mixed/review_only inventory。Review-only
  不引入新目标或推进首学；重复来源不重复建调度；Policy 在首次 Run 创建时提交。
- 正式 Web 首批页面、renderer、Sensa IndexedDB/outbox 和新合同 push→pull；页面提交意图与
  原始响应，服务端产生权威结果。界面显示真实记录、进度、下一次到期和待同步状态。
- 最小 Book/Sense 内容与 primary Target Declared Mastery；授权静态媒体 seam、缺失资源反馈，
  以及已开放设置的 Learner/Device 所有权分离。
- 基础 CI 构建、迁移验证与内部环境交付路径；request/operation/run 关联标识和结构化错误。

**退出条件**：

- 真实浏览器经新 API 写入 Postgres 并恢复投影；刷新和进程重启后仍可继续，而非恢复 fixture。
- 不同账号数据隔离；相同 target 的重复请求或来源保持同一合法学习身份与调度。
- Initial Completion 与首次 Handoff/Memory State 原子且幂等；一次 due Review 只更新一次
  FSRS；失败后 Relearning 不重新初始化、不改写该 Review。
- 受控时间测试证明未来到期与跨日行为正确，生产不保留原型「立即到期」捷径。
- Mixed/Review-only、Declared Mastery、ready/blocked、重复提交及基本 resume 的数据库与
  浏览器 smoke 通过；派生结果由服务端产生，轻量完成不伪装成 Gate、5D 或行为 Evidence。

## 5. M2：浏览器采集、个人语义与按需内容生产化

**目标用例**：浏览器插件或 Web 捕获 Context/Expression → 原位解析或收件箱继续 →
必要时澄清 → 合法 Semantic Acceptance →
stable Sense/Version/Binding 与 Alignment → 显式加入学习 → 内容准备 → 同一 M1 学习链。

交付物：

- 浏览器采集插件：按 M0-2 核定的浏览器/分发范围交付，默认桌面 Chrome。支持主动选区、
  Context/来源预览与固定快照、Expression occurrence、原位确认快轨和收件箱慢轨；同账号
  Web 可继续，不要求对有效确认重复接受。只保存材料不自动加入学习。
- 插件与 Web 的统一认证授权、幂等 Intake/commit 和原账号待提交队列；关闭、重启、断网、
  账号切换和权限撤销可恢复。插件不直接访问模型凭据、写派生进度或后台采集浏览历史。
- 按该用例补齐正式页面、消费合同、持久化和 Sync；Personal Meaning/Anchors、可选 Focus、
  Construction/Proposal/Acceptance/Alignment 各自保存真实身份、版本、授权与操作结果。
- 保留 direct/Book 独立入口；个人意义保存、语义确认、加入学习相互独立。快轨、委托或重试
  也不能越过领域确认门，未形成合法 Target 的裸表达不直接开始学习。
- Semantic LLM 与 Learning Content LLM 分离，分别固定 policy、输入、工具权限、上下文
  provenance 和输出校验；开发代理迁入有身份隔离的生产执行边界。
- Durable Content Provisioning Task/Attempt/Bundle、有限工具与模型预算、超时/重试/取消及
  重启恢复；取消与迟到结果的接受规则明确，避免重复生成和重复收费。
- 固定 Learning Target、Demand 与授权 Context Artifacts；独立验证 schema、角色覆盖、语义
  一致性和 reveal 前资源边界，冻结 Materialization/digest 后才能 ready。作答后不可替换内容。
- 受授权 Personal Anchor 使用、撤销/删除后的后续使用限制和材料处置；公开语义与私人上下文
  分层。日志不默认收录私人全文或凭据。
- 按当前内容合同生成/解析静态音频，可选资源失败与必需资源失败分别处理。Published/Hybrid
  fallback 仅在同一 Target/Policy/Demand 可满足时使用，不静默换学习方法。

**退出条件**：personal-first 与 direct 路径汇合于相同 Target/Runtime seam；重复确认和加入
学习幂等；准备中、校验失败、provider 不可用、权限撤销及恢复均可解释；模型不能提交正式进度。
持久任务经服务重启仍可恢复，冻结材料可重放，并有独立内容质量抽查记录。
必须通过真实浏览器插件 → Intake/语义接纳 → Web → 加入学习的 smoke；包含保存待处理和
完整意义原位确认两条路径。只有 Web 中的采集模拟器不满足本阶段验收。

日常自动验证使用无成本 deterministic/mock adapter。真实 provider、内容质量、延迟与成本
验收单列，使用事先明确授权的预算执行并记录结果；mock 通过不能代替该上线证据，常规
build/smoke 不得调用付费 LLM/TTS。

M2 施工分段见 [消费合同](m2-consumer-contract.md)，A 的本地证据见[交付记录](m2-a-intake-handoff.md)。
C 文本入学及故障检查见[交付记录](m2-c-provisioning-handoff.md)。
原生 activeTab 同源/跨源恢复与账号队列本地证据见[D 交付记录](m2-d-extension-recovery-handoff.md)。
原文授权/撤销与历史保留见[交付记录](m2-anchor-use-handoff.md)。
静态音频本地证据见[交付记录](m2-pronunciation-handoff.md)。
Chrome 151/152 自动链和原生权限、实际 API 进程终止恢复、有限真实内容质量抽查见[最新记录](m2-quality-recovery-handoff.md)。
商店热更新和真实托管仍待外部验收；本地证据不能代表已完成部署或受邀发布。

## 6. M3：连续使用、恢复与数据控制

**目标**：一个账号能够连续多日使用或换设备继续，失败不丢工作、不重复结算，删除后数据不复活。

交付物与验收矩阵：

| 场景 | 必须证明的结果 |
| --- | --- |
| 双设备/双标签页与版本冲突 | 相同操作可重放，冲突结果明确；Target、当前 Run 和调度收敛，不双写派生状态 |
| 断网、刷新、客户端/服务端重启 | outbox 不丢失，Protocol Step 与固定材料可恢复；尚未确认的结果诚实显示 pending |
| Cursor expiry、bootstrap、旧客户端 | 可重新 bootstrap 并处理待提交工作；版本不兼容有明确升级路径，不静默解释旧 payload |
| Completion/Handoff 中途失败 | 故障注入后无半完成状态，重试不产生第二份 Memory State 或重复调度 |
| Review/Relearning 重复和乱序 | 一次 Review 一次更新；重学不改原结果，独立 scheduler-eligible Outcome 若开放也必须独立幂等 |
| 内容生成/媒体失败 | 超时、校验拒绝、缺失、授权过期均可诊断和重试；不让缺少必需材料的计划进入 Runtime |
| 偏好、退出、本机清除 | Learner Preference 收敛，Device Preference 本机保存；pending 未解决时不无提示丢弃，重新 bootstrap 可用 |
| 数据导出 | 请求幂等、可查看处理状态，产物可用且仅本人授权访问，固定导出范围与版本 |
| 账号删除与离线旧设备 | 在线重新授权，撤销 Sessions/Replicas，处理 learner-owned 数据；旧凭据/outbox 不能复活数据 |
| 插件离线/重启/更新与账号切换 | 待采集材料和未知提交结果可恢复；不重复接纳、不串号；旧版本和权限失效有明确恢复路径，账号删除后插件停止写入 |
| 备份与恢复 | 实际恢复演练可核对账号、目标、固定材料、运行事实及调度一致性；明确可接受的数据损失和恢复时间 |

**退出条件**：上述场景有数据库集成和真实浏览器/两个独立设备上下文证据；跨日使用通过，
未解决的数据丢失、串号、重复调度、孤立状态或删除屏障问题为零。自动时间测试不能替代后续
真实用户持续使用，但可以覆盖等待时间和故障边界。

### 首版服务商选型（2026-09-07 owner 已确认）

首版以简单、低成本、小规模受邀用户为优先：统一采用 Supabase Postgres、Auth 和 Storage；
Web 前端采用 Cloudflare 静态托管，验证码邮件通过 Resend SMTP 发送。AWS/Cognito、Neon
和 R2 不再是首版部署前提。此前适配器和基础设施文件属于实现现状，不代表新选型已接通。

业务 API 优先验证 Supabase Edge Functions：检查现有 Node/Hono/pg、共享包、事务与连接池、
执行时限和后台任务的兼容性；验证失败时评估独立 API 托管并记录理由，不能为了集中服务商
跳过学习与同步合同。Postgres 权威存储、LearnerScope、客户端本地 outbox、服务端派生事实及
FSRS 所有权保持不变；Supabase 自动数据 API/Realtime 不替代 Sensa sync 协议。

开发和有限验证可使用 Free；正式受邀环境按 Pro 基础档每月 25 美元起规划。额外项目、升级
计算资源、超额用量、邮件、域名及 AI/TTS 另计，采购时复核价格。设置预算监控、调用限额及
重复请求去重；套餐认证用户额度不是业务并发容量承诺。环境隔离不得为节省项目费而取消。

增长时先按监控与负载证据优化查询、连接池和计算配置；媒体流量或任务执行成为实际瓶颈后
再评估拆分存储或任务服务，不预先建设多云架构。上线前验证目标用户地区的可达性、邮件
送达、备份恢复及权限隔离。选型确认不构成开通、迁移或生产验收证据。

参考：[Supabase 价格](https://supabase.com/pricing)、
[Edge Functions 限制](https://supabase.com/docs/guides/functions/limits)、
[Resend SMTP](https://resend.com/docs/send-with-supabase-smtp)。

## 7. M4：受邀测试环境与发布验收

**目标**：通过可重复的 CI/CD 发布，使已完成的生产闭环可被受邀用户安全、持续地使用。

交付物：

- Cloudflare Web 托管与 Supabase Postgres/Auth/Storage、Resend SMTP 真实接入；在部署前
  验证现有 Node/Hono/pg 执行方式与目标环境的适配、连接和限制，不能只部署本地构建产物。
- CI/CD 完成构建、检查、迁移、部署和 smoke；dev/test 与受邀环境隔离，secrets 不进入仓库。
  配置 TLS、CORS、受邀准入、rate limit、provider 预算、媒体授权/digest/license/cache/range。
- 监控错误、同步积压/冲突、内容准备失败/耗时、媒体缺失、学习入口到完成漏斗及 Data Control
  状态；Product Event 与 Learning Evidence 分开。定义告警阈值、处理责任和关闭入口的方法。
- 发布、数据迁移、回滚、备份恢复、provider 不可用与费用异常的操作说明。给受邀用户提供
  简短的测试说明、已知限制与反馈方式，不需要为此建设完整后台产品。
- 插件可重复构建与版本化产物、普通受邀用户可执行的安装/更新/卸载说明、权限说明和兼容
  页面清单。具体分发方式在 M0-2 确定，发布日程纳入该渠道实际需要的准备时间。
- 在邀请用户前确定观察周期、使用场景、内容抽查方式、可靠性/成本阈值和暂停扩招条件；
  阈值依据内部环境结果设置，不引用历史原型中的经验数字作为实证。

**发布门**：M1–M3 全部验收；真实环境登录、独立学习、个人语义/生成、音频、跨设备、退出、
导出和删除的公网 smoke 通过；部署可重现、回滚和恢复已演练，错误可定位，费用受约束。
插件安装、真实网页采集、原位确认/收件箱交接、重启重试、账号撤销及升级保护同样通过；
浏览器插件未交付时不能声明首轮受邀测试版完成。
允许首发的自由练习、词典、统计、签到分别核对实际资源/来源、账号与同步状态、失败恢复；
签到/练习不得污染正式学习统计、Evidence 或调度。未支持活动不出现虚假可执行入口，
开放与生产验收分列记录。正式 Web 性能和可访问性须达到 M0 确认后的预算与标准。

只有这些条件通过后，才记录版本、环境、证据和已知限制并开始受邀测试。此门不等于公开
V1 发布完成。所有服务商的资源与部署变更一律走 CI/CD，不从本地 shell 部署。

## 8. M5：真实用户验证与后续版本

先让少量受邀用户连续使用，按 M4 预定场景观察能否自主完成两条旅程、回来复习、理解材料
和恢复错误，同时记录内容质量、等待时间、运行成本与可靠性。测试期先修阻断和数据问题，
再处理理解障碍与高频体验摩擦。每次修复补充对应回归场景，避免扩张为无边界测试工程。

**退出条件**：完成预定观察周期，有实际用户反馈、使用/故障/成本数据和内容抽查记录；阻断
问题关闭，未解决项有处置决定；据此决定继续邀请、调整核心体验或启动下一组能力。小样本
的点击、完成、留存和自评不证明长期学习效果；效果研究需要另行设计。

受邀版之后的工作按依赖分组，具体优先级由 M5 证据决定：

| 后续工作 | 开始条件与必须保留的边界 |
| --- | --- |
| Flutter iOS/Android/桌面单一客户端 | Web/API/Sync 与核心恢复场景稳定；SQLite/outbox push→pull，共享语言无关合同和 smoke 规格，独立设计平台 UI，不复制服务端策略/FSRS 权威 |
| 高保证学习 | Structured Protocol、Recognition/Recall/novel Transfer/条件 Boundary、interference、Evidence/5D、Graduation 和完整资源 validator 成套验收；不能成为轻量学习前置条件 |
| Curriculum 与个人内容扩展 | Enrollment/Range/Scope Revision、Supplemental 多来源去重、Collection/Bookmark/Note 的版本与同步；换范围或删除来源不抹除 Target 历史，不静默更改 Committed Policy |
| 词典首发之后的 Reference 与语义投影扩展 | 有 license/provenance 的 Reference Release、reviewed Sense Alignment、exact occurrence 与可信 resolution；查词不改变学习事实，assessment-only 资源不泄露 |
| 首发之后的 Free Practice 扩展 | 四个 Area 的 Activity 合同、资源/provider 与客户端能力交集可执行；首组包括真实语流泛化、情境口语排演、语境推义和情境书面表达；Turn/Observation/Feedback/Artifact 不进入正式证据与调度 |
| 其他扩展 | 通知、浏览器文字插件之外的图片/语音/移动分享/桌面全局采集、更多浏览器、更多偏好/会话管理与 Policy Migration 按明确用例推进 |

更广泛的公开 V1 发布要依据受邀测试结果单独验收内容供给能力、运行成本与容量、支持和数据
生命周期；不因 Web 上线或 Flutter 构建成功自动获得公开发布结论。

## 9. 任务执行与证据维护

每个实施任务必须写明：所属里程碑、具体用户用例、仓库与文件所有权、合同/领域约束、前置
依赖、交付物、验收方法和不包含项。按仓库约定由 supervisor 拆分/审查，实质实现交给默认
implementation worker；同一文件默认只有一个实施 writer。
完整协作方式见 [开发工作约定](development-workflow.md)。一个 worker 可以跨模块贯通用例，
但须遵守各模块的边界；任务应引用已确认的前端产物与本轮施工蓝图。

交付使用统一检查点：

1. **用例就绪**：owner 已确认本次前端体验；蓝图和消费合同足以指导实现，领域边界无未裁决
   冲突。相同范围的既有确认可以复用，不因实施换人重复确认。
2. **实现完成**：正式 UI、权威服务端、存储/迁移与同步按该用例接通，mock 不伪装为生产结果。
3. **验证完成**：根级 typecheck/build/lint 和相关集成/浏览器 smoke 通过；Python 变更至少
   编译和无成本 validator smoke。不得在日常验证中调用付费 LLM/TTS。
4. **交付记录**：写入提交/产物、环境、运行命令、结果、已知限制和下一依赖；真实 provider
   验收与部署证据分别记录，不能由静态检查代替。

阶段状态使用「待执行 / 进行中 / 待验收 / 已验收」。只有退出条件满足并有证据，才更新为
已验收，并同步 current-stage.md。实现受阻时记录具体缺口与可继续的独立任务，不跳过
验收门。范围变化需同步 stage/PRD/相关合同，不在任务里悄悄扩大首发。

### 当前待办队列

2026-09-08 更新：M1/M2 功能链曾接入简化页面，不能视为已确认 UI 验收。
当前已完成已确认 Web 组件接入和简化页面删除的本地检查，待 owner 体验反馈；
见 [界面接入记录](m1-m2-ui-integration-handoff.md)。Owner 已暂缓云端及商店工作，
相关发布项保持未验收，不继续申请凭据或触发交付。

- [x] **M0-1：首轮产品清单与状态矩阵。** Owner 确认八个能力区与通用状态，并加入浏览器
  插件；已写入 [产品基线](first-round-product-baseline.md) 并同步 PRD。插件支持范围和交互
  细节作为实施默认进入 M0-2 走查，不计为已完成的浏览器验证。
- [x] **M0-2：首条生产旅程与插件正式 UI 状态规格（已验收：规格）。**
  产品选择全部确认；[首条规格](m0-2-first-learning-state-spec.md)覆盖登录/数量/准备/首学/
  复习/重学/汇总/签到和通用恢复，[插件规格](m0-2-browser-capture-state-spec.md)覆盖浮层/
  快慢轨/账号交接/权限/安装更新。已补齐失败动作、汇总计数、状态结构示意、组件和初始
  工程预算；复用当前 Web 界面，已同步 stage/PRD/baseline/index。
  文档验收不代表界面新增状态已实现或浏览器、Supabase、同步和性能实测通过。
- [x] **M0-3：M1 消费契约与迁移方案（已验收：设计合同）。**
  [消费合同](m0-3-consumer-contract.md)固定Query/Command/Projection/error/revision/Sync v3，
  [迁移蓝图](m0-3-migration-blueprint.md)记录v2 Target/旧SQL差异、历史保留、目标目录与
  Supabase适配；[施工验收](m0-3-delivery-plan.md)给出单writer纵切及20个关键向量。
  根级检查和既有合同/Sync smoke通过；这些证据不表示新合同已实现。
- [x] **M0 设计验收。** 产品范围、体验状态、消费合同与结构迁移产物齐备，没有未裁决的
  M1产品流程问题。新wire schema、数据库迁移与运行验证在M1依序实施。
- [ ] **M1-A：受邀登录与数量确认。** 本地纵切已实施并验证，见[交付记录](m1-a-account-handoff.md)；托管 Supabase 与 CI 实际运行仍待验证。 按施工表先验证Edge适配，再接通真实账号、
  LearnerScope、首次明确数量与空首页；仍走CI/CD部署，无付费内容生成验证。

- [ ] **M1-B：目标加入与准备。** 本地纵切及 DeepSeek/edge-tts 小样本已验证，见[M1-B 记录](m1-b-target-handoff.md)；生产内容发布和托管 Storage 待验收。
- [ ] **M1-C：首学与结果确认。** 本地纵切已实施并验证，见[交付记录](m1-c-initial-handoff.md)；托管验收仍待执行。
- [ ] **M1-D：到期复习与重学。** 本地纵切已验证，见[交付记录](m1-d-retention-handoff.md)。
- [ ] **M1-E：签到与恢复验收。** 本地纵切已验证，自动/手动签到独立于学习结果，已串联 A–E；见[交付记录](m1-e-checkin-handoff.md)。真实托管验收仍待执行。

此队列只列下一批具体任务。M1 以后按退出条件拆分，不预先生成脱离已确认用例的完整横向
任务库。M0-1 产品基线已记录；M0 设计已验收；M1–M5 均尚未验收。

M0-2 后续确认记录：Q1 登录体验与 Q8 签到规则已确认，详见首条规格第 12 节；真实 Supabase Auth
验证码配置仍需核实。开始正式学习自动签到与学习结果严格分离，合同/持久化尚未接入。
