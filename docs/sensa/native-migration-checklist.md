# TS 成果向 Rust / Flutter 迁移清单

日期：2026-09-08。Owner 已同意建立迁移清单。本文是首版范围登记，尚未完成逐文件盘点，不能据此计算完成百分比；阶段事实以 current-stage.md 为准。

Owner 最新确认：Flutter/Rust 原生 PC/移动应用是确定的主产品；Web 保留当前成果，暂停新增建设，是否最终开放以后决定。浏览器插件和 Hono 在线服务继续使用 TS；同步先面向原生设备，沿用 ADR 0001 的可选 E2EE，不实施 Web WASM 或 Web/本地互通作为当前前置条件。

迁移最终范围是完整承接已有 Web 的功能、业务规则、状态和恢复行为，并保留现有学习内核扩展性。分批次只改变交付顺序，不裁剪功能。正式界面以 apps/web 为依据；其 experience 中仍用原型存储的能力也必须登记、迁移并重新验收，不能因为它尚未接入生产 API 就从清单中删除。历史原型 UI 不作为新的正式 UI 来源。

| 用例/范围 | 现有成果入口 | Rust / Flutter 目标 | 当前状态与验收门 |
| --- | --- | --- | --- |
| 轻量首学与首次调度 | packages/learning-kernel、apps/api；local-settlement-handoff.md | crates/sensa-core、crates/sensa-library、apps/sensa_native | 合成材料技术纵切已通过 macOS/Android 首学及独立进程恢复；见 native-local-learning-handoff.md，不能标作完整正式学习用例 |
| 正式学习包导入与入学 | packages/content-validator、packages/contracts、apps/api、apps/web | 本地校验、版本固定、SQLite 原子入学及 Flutter 资源入口 | 有界轻量文本包的本地导入、版本保护、显式入学与多目标首学已实现；完整 Published Package/角色材料和媒体仍待迁移，见 native-pack-import-handoff.md |
| 到期复习与重学 | packages/learning-kernel/src/runtime/consumerInitial.ts、consumerSettlement.ts、scheduling.ts；apps/api；apps/web | Rust 协议/调度与 Flutter 学习界面 | 三 purpose 纯决策/FSRS、轻量 SQLite Review/Need/Outcome 事务及 Flutter 等待/恢复已接入；平台证据见 native-retention-handoff.md；正式 Activity/Mixed 计划与去重汇总仍待迁移 |
| 多目标、每日计划、签到、记录及其他已有策略 | apps/api、apps/web、相关合同 | Rust 本地应用规则、读模型与 Flutter 页面 | 待逐项盘点；区分正式实现与原型证据，已有学习策略和扩展机制不因分阶段迁移而省略 |
| 个人语义世界与快慢轨 | apps/api、apps/web、packages/contracts | 本地 Context/Sense/Expression、可选 Focus、接受与恢复流程 | 待迁移；保持领域语义与显式加入学习 |
| 网页 / YouTube 采集交接 | apps/browser-extension、apps/api | 现有 TS 插件交接至本地库 | 插件继续使用 TS；本地交接、幂等和隔离待验收 |
| Agent 入口 | 已确认完整蓝图及相关合同 | 与其他采集端一致的本地接受入口 | 待盘点当前实现，不宣称已有完整 Agent 成果 |
| LLM / 资源任务 / 音频协作 | apps/api、packages/content-validator、apps/web | Hono 保留在线执行；Rust/Flutter 固定结果、存储与恢复 | 待划分在线服务与本地任务状态，按用例迁移 |
| 完整原生界面 | apps/web 已确认体验 | apps/sensa_native | 首学/复习/再学习验收壳已接入；导航、语义世界等尚未整体迁移 |
| React Web 保留 | apps/web、packages/learning-kernel | 当前成果、行为与回归依据保留 | 暂停新建设；是否开放后定，WASM 不在当前施工范围 |
| 备份恢复与可选 E2EE 同步 | ADR 0001 / 本地迁移蓝图 | 本地完整导出恢复、密文同步与本地合并 | 新架构工作，不能算作已有 TS 同步代码直接迁移 |
| 旧用户数据导入 | 现有 Web/API 存储 | 显式导入、校验与回退 | 尚未实施；不迁移 owner 数据、不双写 |

每条后续补齐：具体源模块、保留/迁移边界、目标模块、合同版本、验收命令与证据、旧实现停用条件。旧 TS 规则在对应 Rust 用例通过一致性及事务验收前保留为对照。

## 学习内核扩展性：不可遗漏的迁移项

以下已核对实际源文件。代码存在不等于正式产品已验收；迁移时必须复现它的合同和扩展边界，不能以单一轻量流程替代。

| 职责 | 实际 TS 来源 | Rust / Flutter 边界与状态 |
| --- | --- | --- |
| 协议推进与结果资格 | packages/learning-kernel/src/runtime/consumerInitial.ts、consumerSettlement.ts | 已迁入 sensa-core/protocol.rs、settlement.rs；三种 purpose，未知版本拒绝；尚非完整通用 Protocol Runtime |
| 可配置 FSRS 与历史重建 | packages/learning-kernel/src/runtime/scheduling.ts、workspaceConfig.ts | 已迁入 sensa-core/scheduling.rs；四档评分、保留率、步长、最大间隔、确定性 fuzz；不是新 UI 设置或同步合并授权 |
| Progression Kernel | packages/learning-kernel/src/runtime/protocolProgression.ts | 待迁移 credit/invalidate/repair/reassess/reset/complete、epoch 与 Checkpoint 不变量 |
| 正交策略与组合校验 | apps/web/src/experience/learningRuntime/protocolPolicies.ts、runtimeComposition.ts | 待迁移 Evaluation/Progression/Completion/Repair/Memory Outcome 注册及引用完整性；不得按 Profile 名称复制分支或静默降级 |
| Profile 与 Policy 生命周期 | apps/web/src/experience/learningRuntime/policyProfiles.ts；learning-connection-model.md | 待迁移 Assignment 优先级、purpose plan/readiness、首次 Run commitment；历史不随普通配置变化重写 |
| 编排、运行与存储适配 | apps/web/src/experience/learningRuntime/orchestrations.ts、runtimeCoordinator.ts、runtimeSession.ts、runtimeSurfaces.ts、retentionStores.ts | 待迁移 fresh/repair、暂停恢复、运行表面与存储职责；每日数量留在 Planner |
| 目标与内容能力 | apps/web/src/experience/learningRuntime/retentionScopes.ts、contentCapabilities.ts | 待迁移 scope 准入和能力合取；普通题型不拆分调度身份 |
| 材料与生成 | apps/web/src/experience/learningRuntime/contentProvisioning.ts、contentAgentProvisioning.ts；packages/contracts/src/sensa/learningContent.ts | 待迁移独立候选校验、固定 Materialization、来源/用途/版本；模型生成不直接写学习结果 |
| 呈现与学习模式 | apps/web/src/experience/learningRuntime/stepRenderers.tsx、lightweightInitialPresentation.ts、lightweightInitialProtocol.ts、interleavedFourStageProtocol.ts | 规则/资源绑定迁 Rust，renderer 迁 Flutter；保留 intent/disclosure、轻量及已有多阶段行为，界面按正式 Web 验收 |

现已继续实现有界文本包导入及多目标首学；纯内核基础见 [迁移记录](native-kernel-migration-handoff.md)。轻量复习/再学习事务与 Flutter 状态见 [本轮记录](native-retention-handoff.md)。后续继续完整角色学习包/媒体、通用 Runtime 扩展机制、正式 Activity 与汇总；上述未完成项全部保留，不能把本轮对照用例数换算为全项目完成率。
