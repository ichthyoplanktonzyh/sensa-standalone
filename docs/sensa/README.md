# Sensa 文档索引

> 状态：Active index  
> 更新日期：2026-09-07

本目录不再把所有设计记录都当作“领域模型”。文档按职责分层；下层文档不能覆盖
上层文档的定义。

## 领域模型

以下七份文档共同构成 Sensa 的领域模型：

| 文档 | 唯一职责 |
| --- | --- |
| [`../../CONTEXT.md`](../../CONTEXT.md) | 统一语言与产品边界 |
| [`production-architecture.md`](production-architecture.md) | 领域总图、聚合、Account/Settings/Data Control、Curriculum/Personal Content 生命周期、Lexical Reference、语义投影、自由练习、模块边界和全局不变量 |
| [`personal-semantic-world-model.md`](personal-semantic-world-model.md) | 泛在 Semantic Intake 快慢轨、完整 Context–Expression–Sense Personal Meaning、optional Focus、直接/委托 Semantic Acceptance、Sense 构造与学习交接边界 |
| [`learning-connection-model.md`](learning-connection-model.md) | 独立 Book/direct/personal-first learning entries 与 Learning Entry Provenance、Learning Target/Capability Objective/Retention Target、learner-selectable Learning Policy、Resolved Learning Plan、published/on-demand/hybrid 内容供给、三种 Protocol Purpose、Protocol Step/Checkpoint/Card 边界、Profile 策略组合、学习结果、graded Memory Outcome、Relearning scheduler 资格与 FSRS Scheduling Handoff |
| [`semantic-acquisition-model.md`](semantic-acquisition-model.md) | Structured Acquisition Protocol 的 Gates、五维诊断、Semantic Field、Lexical Reference 支架与四个 Practice Area 的理论边界 |
| [`sense-learning-resource-model.md`](sense-learning-resource-model.md) | Published/On-demand 学习内容、Materialization、教学/检验/练习资源、Reference Lexicon 与发布语义 |
| [`learning-runtime-model.md`](learning-runtime-model.md) | Account/Preferences/Data Control、Curriculum/Personal Content lifecycle、Learning Policy Assignment/plan readiness、Contextual Lookup、Unified Planning、Protocol Run/Step、Attempt→Observation→Evidence→Transition、Checkpoint/Progress Reset、正式 Session/Encounter/Outcome、Free Practice Area/Activity 与 FSRS 的隔离关系 |

发生冲突时，先用 `CONTEXT.md` 确认术语，再由
`production-architecture.md` 确认对象边界；个人语义建构与 Sense 确认由
`personal-semantic-world-model.md` 裁决；学习内容来源、方法、声明和调度交接由
`learning-connection-model.md` 裁决；资源问题由
`sense-learning-resource-model.md` 裁决，运行行为由
`learning-runtime-model.md` 裁决。理论文档解释设计理由，但不能直接新增数据库字段、
固定页面顺序或发布配额。

领域模型同时覆盖五条职责不同的产品链：Personal Semantic World 与按需 Sense Construction、
protocol-driven Learning/Retention、Reference Lexicon 与 Contextual Lookup、跨个人意义/已发布内容/进度的
Learner Semantic Projection，以及与正式证据链隔离的 Free Practice。当前 PRD 可以分阶段交付这些
能力，但实现合同不能把尚未交付的 LLM 对话、词典、个人内容或练习原型冒充领域事实。

五条产品链共同依赖一个支持边界：Account 负责访问与生命周期，Learner 负责学习事实，typed
Learner/Device Preferences 负责未来呈现选择，Data Control 负责导出/删除。Settings Surface 只是
组合入口，不是第五条学习链或通用状态聚合。

## 其他当前文档

2026-09-08 Owner 已确认[本地学习库与可选加密同步的架构决策](../adr/0001-local-library-optional-encrypted-sync.md)。
目标方向已接受、已启动本地底座迁移，用户库尚未切换；架构、阶段与路线图已标注过渡状态，后续消费合同不得继续
把个人事实必须由服务器裁决作为不可调整的产品规则。

这些文档仍有用途，但不属于领域模型：

| 状态 | 文档 | 职责 |
| --- | --- | --- |
| Canonical stage | [`current-stage.md`](current-stage.md) | 当前里程碑、证据级别和交付边界 |
| Canonical product | [`product-requirements-v1.md`](product-requirements-v1.md) | V1 IA、用户旅程和交互验收 |
| Accepted first-round scope | [`first-round-product-baseline.md`](first-round-product-baseline.md) | M0-1 首轮九个能力区、浏览器采集插件边界及产品/插件/通用状态矩阵；不替代领域与 API 合同 |
| Completed M0-2 specification | [`m0-2-first-learning-state-spec.md`](m0-2-first-learning-state-spec.md) | M0-2 登录、首次使用与轻量首学/复习/重学状态、恢复与确认清单；体验已确认，实施待验收，不替代路线图或 M0-3 合同 |
| Completed M0-2 plugin specification | [`m0-2-browser-capture-state-spec.md`](m0-2-browser-capture-state-spec.md) | M0-2 捕获、原位确认、Web 交接、安装更新与账号恢复状态；交互形态/渠道已确认，实际运行待验收 |
| Accepted M0-3 consumer contract | [`m0-3-consumer-contract.md`](m0-3-consumer-contract.md) | M1 Query/Command/Projection、Sync v3、身份/版本/结果/离线/调度合同；新接口设计；M1-A 数量子集已实现，完整合同仍待后续切片 |
| Accepted M0-3 blueprint | [`m0-3-migration-blueprint.md`](m0-3-migration-blueprint.md) | 代码/SQL差异、目标目录、所有权、增量迁移和Supabase适配检查点 |
| M1 execution input | [`m0-3-delivery-plan.md`](m0-3-delivery-plan.md) | M1纵向任务所有权、20个验收向量、预算与M0-3设计验收记录 |
| M1-A local implementation | [`m1-a-account-handoff.md`](m1-a-account-handoff.md) | 登录、数量、空首页纵切的实现范围、本地测试、运行步骤与托管验收缺口 |
| M1-B local implementation | [`m1-b-target-handoff.md`](m1-b-target-handoff.md) | 目录、加入、准备、私有材料与已会声明的本地纵切；DeepSeek/edge-tts 实际小样本与待验收边界 |
| M1-C local implementation | [`m1-c-initial-handoff.md`](m1-c-initial-handoff.md) | 正式首学、离线回答、暂停恢复与一次性调度结算；本地集成/浏览器证据与时间合同细化 |
| M1-D local implementation | [`m1-d-retention-handoff.md`](m1-d-retention-handoff.md) | 到期复习、一次 Memory Outcome、10 分钟重学与去重汇总的本地纵切 |
| M2 contract | [`m2-consumer-contract.md`](m2-consumer-contract.md) | M2 分段、固定采集输入、插件授权与后续确认/供给边界 |
| M2-A local implementation | [`m2-a-intake-handoff.md`](m2-a-intake-handoff.md) | 实际插件采集、PKCE、收件箱持久与同账号 Web 本地证据；原生权限矩阵待验收 |
| M2-B local implementation | [`m2-b-semantic-handoff.md`](m2-b-semantic-handoff.md) | 固定候选、原位/Web 直接接受和稳定语义 registry 的本地证据 |
| M2-C local implementation | [`m2-c-provisioning-handoff.md`](m2-c-provisioning-handoff.md) | 个人意义显式入学、持久任务/独立校验/冻结文本材料及 M1 Runtime 本地证据 |
| M2 content recovery | [`m2-content-recovery-handoff.md`](m2-content-recovery-handoff.md) | Web 明确关注点、重新解释、旧候选拒绝与可恢复移除/恢复的本地证据 |
| M2 quality/recovery/compatibility | [`m2-quality-recovery-handoff.md`](m2-quality-recovery-handoff.md) | 真实个人场景质量复测、SIGKILL 恢复与 Chrome 151/152 原生权限证据 |
| M1/M2 Web UI integration | [`m1-m2-ui-integration-handoff.md`](m1-m2-ui-integration-handoff.md) | 已确认 Web 界面接入真实账号链路、简化页面删除及本地浏览器证据 |
| M2 reading interaction | [`m2-reading-interaction-handoff.md`](m2-reading-interaction-handoff.md) | 轻量划词工具栏、按需解释、保存预览、拖动／本机朗读及闭源实现边界；本地验证完成，owner 继续体验 |
| Browser port implementation | [`browser-port-contract.md`](browser-port-contract.md) / [`browser-port-handoff.md`](browser-port-handoff.md) | 参考陪读蛙源码独立实现的 Provider、网页阅读与视频采集纵切；实际测试和未完成兼容范围见交付记录 |
| Browser port deferred follow-ups | [`browser-port-followups.md`](browser-port-followups.md) | Owner 已结束本轮优化；保存恢复、原位慢轨、真实模型、字幕轨道、偏好记忆及兼容性差距留待回访，尚未实施或排期 |
| Release authorization | [`release-authorization.md`](release-authorization.md) | 云端/商店所需具体授权、项目访问和发布前产物 |
| M2 static pronunciation | [`m2-pronunciation-handoff.md`](m2-pronunciation-handoff.md) | 按需材料静态发音绑定、真实 TTS 小样本、离线播放和可选音频失败回退 |
| M2 private context | [`m2-anchor-use-handoff.md`](m2-anchor-use-handoff.md) | 原文显式授权、撤销/迟到结果隔离、历史保留与后续复习材料替换的本地证据 |
| M2-D local recovery | [`m2-d-extension-recovery-handoff.md`](m2-d-extension-recovery-handoff.md) | 插件原账号队列、版本保护及实际原生 activeTab 权限恢复的本地证据 |
| Local settlement extraction | [`local-settlement-handoff.md`](local-settlement-handoff.md) | LF-1a 共用结算与 Node/断网 Chrome/隔离 Postgres 回归；本地库持久化仍待实施 |
| Native migration checklist | [`native-migration-checklist.md`](native-migration-checklist.md) | 已有 TS 成果的保留/迁移范围、验收状态；首版登记，待逐项盘点 |
| Native pack import | [`native-pack-import-contract.md`](native-pack-import-contract.md) / [`native-pack-import-handoff.md`](native-pack-import-handoff.md) | 有界文本包、显式入学、多目标首学、版本保护与原生验收；完整发布包/媒体仍待迁移 |
| Native progression | [`native-progression-handoff.md`](native-progression-handoff.md) | 通用 Checkpoint 进度、正交策略 Registry、组合引用校验与原生入口；通用持久化/多阶段 UI 仍待接入 |
| Native policy | [`native-policy-handoff.md`](native-policy-handoff.md) | 策略分配、purpose 准备状态、首次 Run 固定及本地 schema 升级；其他学习模式仍待接入 |
| Native progress journal | [`native-progress-journal-handoff.md`](native-progress-journal-handoff.md) | Observation/Decision/Checkpoint SQLite 账本、consumer 接入与历史恢复；多阶段编排仍待迁移 |
| Native four-stage orchestration | [`native-four-stage-orchestration-handoff.md`](native-four-stage-orchestration-handoff.md) | 四阶段与复习队列、版本化快照和源差分；Owner 已将其定位为扩展性验证，正式材料/UI 暂停 |
| Native assurance orchestration | [`native-assurance-orchestration-handoff.md`](native-assurance-orchestration-handoff.md) | 高保证 Step 选择、定向修复与通用账本组合；完整生命周期、评价/事务及界面仍待迁移 |
| Native retention | [`native-retention-handoff.md`](native-retention-handoff.md) | 轻量本地复习结算、等待/提前/同 Run 恢复及原生验证；正式 Activity 与去重汇总仍待迁移 |
| Native kernel migration | [`native-kernel-migration-handoff.md`](native-kernel-migration-handoff.md) | 三 purpose 决策、可配置 FSRS、TS 差分及本地首学事务接入；完整原生复习仍待完成 |
| Native local learning slice | [`native-local-learning-handoff.md`](native-local-learning-handoff.md) | Flutter/Rust/SQLite 首学技术纵切的实际证据与未完成边界 |
| Native client architecture | [`../adr/0002-flutter-rust-local-core.md`](../adr/0002-flutter-rust-local-core.md) | Flutter/Dart 主应用、Rust 本地权威、TS 浏览器/云端；正式 Web 界面作为参考，首个原生技术纵切已在 macOS/Android 验证 |
| Local library migration | [`local-library-migration-blueprint.md`](local-library-migration-blueprint.md) | 本地领域/存储/服务职责、单设备首条用例、浏览器交接、同步设计门与旧数据回退；整库离线尚未交付 |
| Active roadmap | [`production-migration-plan.md`](production-migration-plan.md) | M0–M5 生产化路线图：正式产品与消费契约、生产闭环、恢复与数据控制、受邀发布和用户验证；含依赖、验收门与当前待办 |
| Current working agreement | [`development-workflow.md`](development-workflow.md) | 可调整的开发方式：全局结构蓝图、owner 参与前端确认、消费契约、主代理直接实现与端到端验收；不替代领域或路线图 |
| M1-E local implementation | [`m1-e-checkin-handoff.md`](m1-e-checkin-handoff.md) | 手动/正式学习签到、原日期离线上传、账号隔离恢复与 A–E 集成验收 |
| Active decomposition | [`learning-extensibility-architecture.md`](learning-extensibility-architecture.md) | `web-next` 学习扩展性的实现 seam；把领域已有的显式 retention scope 扩展规定落到实现层，不新增领域定义 |

当前路线图 M0 设计已验收，M0-1/2/3 产物齐备，M1-A/B/C/D/E 本地纵切已验证、托管验收待执行，近期里程碑已改为 Flutter/Rust 原生本地学习库；Web 保留当前成果，暂停新建设，是否对外开放后定。领域能力、原型中已经验证的能力和首轮生产交付范围分别管理，不能从原型菜单
或完整领域目录推导上线清单。

原先的 `content-kernel-contract.md`、`curriculum-runtime-contract.md`、`runtime-rule-packet-v1.md`、
`runtime-rule-packet-v2.md` 与 `sensa-sync-contract.md` 已移除，不再列为当前可执行文档；旧事实
可从 Git 历史追溯。当前实现依据仓库内的 [共享合同](../../packages/contracts/src/sensa/index.ts)、
[数据库迁移](../../db/migrations/)及 API/客户端代码核查。新生产用例合同按路线图随用例交付并在
本索引登记，不恢复旧文档来替代新合同。

实现合同描述当前代码或历史事实，不自动成为永久领域规律。2026-08-27 接受的 Acquisition Cycle
仍是 Structured Acquisition Protocol 的 canonical 模型，但不再是所有学习目标的唯一协议；新实现
必须通过 versioned Learning Protocol、Content Provisioning 与 Scheduling Handoff contracts 落地，
不能静默重解释旧 Encounter。当前 validator 的例句数量仍只是 V3 Structured Acquisition delivery
profile，而不是 `Sense`、Lightweight Study 或全部 Learning Protocol 的定义。

## 操作文档和参考材料

- [`../../apps/web-next/journeys/README.md`](../../apps/web-next/journeys/README.md)：当前阶段已冻结的两条
  canonical frontend narrative；只裁决 `web-next` 页面叙事，不能覆盖本目录领域模型；
- [`../../content/README.md`](../../content/README.md)：内容工具当前实际支持的命令与安全边界；
- [`../../apps/web/README.md`](../../apps/web/README.md)：Web 本地运行说明；
- [`../../infra/README.md`](../../infra/README.md)：基础设施边界；
- [`../migration-foundation.md`](../migration-foundation.md)：standalone baseline 的实现快照；
- `docs/reference/bbdc/`：不背单词外壳参考；
- [`../reference/read-frog/product-review.md`](../reference/read-frog/product-review.md)：陪读蛙产品与扩展源码评估、可借鉴体验、YouTube 能力边界与后续用例建议；非实施合同；
- `docs/reference/sensa-v1/`：已接受的 Sensa V1 交互原型。

参考材料只能说明来源或帮助视觉检查，不能定义领域对象和运行所有权。
