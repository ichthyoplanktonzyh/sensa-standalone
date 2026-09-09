# TS 成果向 Rust / Flutter 迁移清单

日期：2026-09-08。Owner 已同意建立迁移清单。本文是首版范围登记，尚未完成逐文件盘点，不能据此计算完成百分比；阶段事实以 current-stage.md 为准。

2026-09-08 历史确认（Web 终局范围已由 ADR 0003 更新）：Flutter/Rust 原生 PC/移动应用是确定的主产品；Web 保留当前成果，暂停新增建设，是否最终开放以后决定。浏览器插件和 Hono 在线服务继续使用 TS；同步先面向原生设备，沿用 ADR 0001 的可选 E2EE，不实施 Web WASM 或 Web/本地互通作为当前前置条件。

迁移最终范围是完整承接已有 Web 的功能、业务规则、状态和恢复行为，并保留现有学习内核扩展性。分批次只改变交付顺序，不裁剪功能。正式界面以 apps/web 为依据；其 experience 中仍用原型存储的能力也必须登记、迁移并重新验收，不能因为它尚未接入生产 API 就从清单中删除。历史原型 UI 不作为新的正式 UI 来源。

2026-09-08 Owner 范围修订：四阶段原型只作为内核扩展性验证。其现有 Rust 编排/源差分保留，
正式材料和 UI 暂停，不要求为了迁移完整性补造尚未确认的四阶段界面。高保证学习继续作为正式优先迁移对象。

| 用例/范围 | 现有成果入口 | Rust / Flutter 目标 | 当前状态与验收门 |
| --- | --- | --- | --- |
| 轻量首学与首次调度 | packages/learning-kernel、apps/api；local-settlement-handoff.md | crates/sensa-core、crates/sensa-library、apps/sensa_native | 合成材料技术纵切已通过 macOS/Android 首学及独立进程恢复；见 native-local-learning-handoff.md，不能标作完整正式学习用例 |
| 正式学习包导入与入学 | packages/content-validator、packages/contracts、apps/api、apps/web | 本地校验、版本固定、SQLite 原子入学及 Flutter 资源入口 | 有界轻量文本包的本地导入、版本保护、显式入学与多目标首学已实现；高保证 runtime release/角色资源/静态媒体已接入并验收，见 native-assurance-integration-handoff.md；上游发布治理与在线生成仍待迁移 |
| 到期复习与重学 | packages/learning-kernel/src/runtime/consumerInitial.ts、consumerSettlement.ts、scheduling.ts；apps/api；apps/web | Rust 协议/调度与 Flutter 学习界面 | 三 purpose 纯决策/FSRS、轻量 SQLite Review/Need/Outcome 事务及 Flutter 等待/恢复已接入；平台证据见 native-retention-handoff.md；正式 Activity/Mixed、独立签到与去重汇总已接入，见 native-activity-integration-handoff.md |
| 多目标、每日计划、签到、记录及其他已有策略 | apps/api、apps/web、相关合同 | Rust 本地应用规则、读模型与 Flutter 页面 | Activity/Mixed、Review-only、每日 Introduction 与独立签到/近期记录已迁移；完整 Curriculum lifecycle/Book Range、来源选择及长历史检索仍待逐项验收；见 native-activity-integration-handoff.md |
| 个人语义世界与快慢轨 | apps/api、apps/web、packages/contracts | 本地 Context/Sense/Expression、可选 Focus、接受与恢复流程 | 本机文本收件箱、已有 Sense 直接接受（Focus 可选）、移除恢复与显式入学已接入，见 native-personal-world-handoff.md；在线澄清/新 Sense 构造与本地接受已接入，见 native-semantic-resolution-handoff.md；多模态/草稿、图谱等仍待迁移 |
| 网页 / YouTube 采集交接 | apps/browser-extension、apps/api | 现有 TS 插件交接至本地库 | 插件继续使用 TS；本地交接、幂等和隔离待验收 |
| Agent 入口 | 已确认完整蓝图及相关合同 | 与其他采集端一致的本地接受入口 | 待盘点当前实现，不宣称已有完整 Agent 成果 |
| LLM / 资源任务 / 音频协作 | apps/api、packages/content-validator、apps/web | Hono 保留在线执行；Rust/Flutter 固定结果、存储与恢复 | 在线语义请求、候选/接受本地状态与 Hono 解析已贯通；个人意义入学、轻量按需文本生成/独立校验/冻结与双平台恢复已接入，见 native-provisioning-handoff.md；Anchor Use、流式解释预览与音频协作仍待迁移 |
| 完整原生界面 | apps/web 已确认体验 | apps/sensa_native | 首学/复习/再学习验收壳已接入；导航、语义世界等尚未整体迁移 |
| React Web 保留 | apps/web、packages/learning-kernel | 当前成果、行为与回归依据保留 | 已确定终局为本地客户端；原生迁移后实施 React/TS 本地事务/调度与离线资源，WASM 非前置 |
| 备份恢复与可选 E2EE 同步 | ADR 0001 / 本地迁移蓝图 | 本地完整导出恢复、密文同步与本地合并 | 新架构工作，不能算作已有 TS 同步代码直接迁移 |
| 旧用户数据导入 | 现有 Web/API 存储 | 显式导入、校验与回退 | 尚未实施；不迁移 owner 数据、不双写 |

每条后续补齐：具体源模块、保留/迁移边界、目标模块、合同版本、验收命令与证据、旧实现停用条件。旧 TS 规则在对应 Rust 用例通过一致性及事务验收前保留为对照。

## 三端终局与验证顺序（2026-09-09）

Owner 已确认 [ADR 0003](../adr/0003-three-client-local-facts.md)：Web 保留 React/TS 并在原生迁移后改为完整本地执行；共同事实模型先行，验证贯穿迁移。当前有界 G0 实验通过，G1 原生真实事实/多副本、G2 Web/TS-Rust 差分、G3 三端/E2EE 均未完成，见 [验收门](personal-library-fact-model.md)。同步/本地备份仍属新架构工作；未选定完整学习分支裁决算法，不能从旧 outbox 或单机 revision 推导已完成同步。

## 学习内核扩展性：不可遗漏的迁移项

以下已核对实际源文件。代码存在不等于正式产品已验收；迁移时必须复现它的合同和扩展边界，不能以单一轻量流程替代。

| 职责 | 实际 TS 来源 | Rust / Flutter 边界与状态 |
| --- | --- | --- |
| 协议推进与结果资格 | packages/learning-kernel/src/runtime/consumerInitial.ts、consumerSettlement.ts | 已迁入 sensa-core/protocol.rs、settlement.rs；三种 purpose，未知版本拒绝；尚非完整通用 Protocol Runtime |
| 可配置 FSRS 与历史重建 | packages/learning-kernel/src/runtime/scheduling.ts、workspaceConfig.ts | 已迁入 sensa-core/scheduling.rs；四档评分、保留率、步长、最大间隔、确定性 fuzz；不是新 UI 设置或同步合并授权 |
| Progression Kernel | packages/learning-kernel/src/runtime/protocolProgression.ts | 纯内核已迁移 credit/invalidate/repair/reassess/reset/complete、epoch 与 Checkpoint 不变量，通过 TS 差分；通用状态的 SQLite 账本已接入轻量三 purpose，并验证多 Checkpoint 重置/恢复；多阶段 Flutter 消费仍待接入，见 native-progress-journal-handoff.md |
| 正交策略与组合校验 | apps/web/src/experience/learningRuntime/protocolPolicies.ts、runtimeComposition.ts | 五轴 Registry/引用校验及三种 Progression 策略已迁移，原生入口校验真实轻量组合；专用编排/scope Registry 和行为执行器仍待迁移，见 native-progression-handoff.md |
| Profile 与 Policy 生命周期 | apps/web/src/experience/learningRuntime/policyProfiles.ts；learning-connection-model.md | 四级 Assignment、版本化 purpose plan/readiness、首次 Run commitment 与 Flutter 设置已接入；普通配置不重写历史；Policy Migration 经本轮源盘点确认为尚无 Web 执行实现的蓝图扩展，单独保留，见 native-policy-handoff.md |
| 编排、运行与存储适配 | apps/web/src/experience/learningRuntime/orchestrations.ts、runtimeCoordinator.ts、runtimeSession.ts、runtimeSurfaces.ts、retentionStores.ts | 高保证 fresh/repair Step 选择已迁移，见 native-assurance-orchestration-handoff.md；LearnQueue 纯生命周期/撤销/恢复已迁移，见 native-assurance-lifecycle-handoff.md；ReviewQueue 纯生命周期及 effect 对照已迁移，见 native-assurance-review-handoff.md；正式材料/评价/事务/Flutter 已接入，见 native-assurance-integration-handoff.md。四阶段保留扩展性验证，正式施工暂停；每日数量留在 Planner |
| 目标与内容能力 | apps/web/src/experience/learningRuntime/retentionScopes.ts、contentCapabilities.ts | 能力合取已迁移并对照 TS；scope 准入仍待迁移，普通题型不拆分调度身份 |
| 材料与生成 | apps/web/src/experience/learningRuntime/contentProvisioning.ts、contentAgentProvisioning.ts；packages/contracts/src/sensa/learningContent.ts | 轻量按需文本的独立候选校验、固定 Materialization、来源/用途/版本已接入，见 native-provisioning-handoff.md；模型生成不写学习结果，Anchor Use 与其余资源协作仍待迁移 |
| 呈现与学习模式 | apps/web/src/experience/learningRuntime/stepRenderers.tsx、lightweightInitialPresentation.ts、lightweightInitialProtocol.ts、interleavedFourStageProtocol.ts | 高保证的资源、评价绑定与 Flutter 呈现已验收；四阶段只保留扩展性证据，其正式材料/界面暂停，保留 intent/disclosure |

现已继续实现有界文本包导入及多目标首学；纯内核基础见 [迁移记录](native-kernel-migration-handoff.md)。轻量复习/再学习事务与 Flutter 状态见 [本轮记录](native-retention-handoff.md)。后续继续完整角色学习包/媒体、通用 Runtime 扩展机制、正式 Activity 与汇总；上述未完成项全部保留，不能把本轮对照用例数换算为全项目完成率。

## 怎样判定迁移完成（2026-09-09 更新）

当前已经贯通的是原生轻量与高保证学习主链及通用内核基础，不是完整产品迁移。
不能按提交数、文件数或差分测试数量换算百分比。待逐用例形成验收证据的主要工作可归为以下工作组（第 2 组本轮已完成当前学习入口纵切）：

1. **其余学习 Runtime**：高保证执行与 Action/材料绑定已贯通；其余 scope 准入及确认纳入产品的已有策略行为仍需逐项验收；Policy Migration 为未来蓝图扩展，区别于既有 TS 迁移；四阶段按 Owner 指示仅保留扩展性验证。
2. **正式学习组织**：Activity/Mixed、Review-only、每日 Introduction、签到、近期记录与去重汇总已贯通，见 [交付记录](native-activity-integration-handoff.md)。完整 Curriculum/Book Range 与来源选择仍随对应产品入口迁移。
3. **个人语义世界**：本机文本收件箱、已有 Sense 的 Context/Expression 直接接受、移除恢复、显式加入学习已贯通，见 [本轮记录](native-personal-world-handoff.md)。在线澄清/Proposal/新 Sense 本地构造与接受已贯通，见 [语义协作记录](native-semantic-resolution-handoff.md)。多模态与草稿恢复、图谱/表达分支、Anchor Use 任务协作仍需迁移。
4. **完整资源与在线任务协作**：高保证发布物/静态媒体/固定材料化已接入；个人意义轻量文本 LLM 任务、独立校验、结果接纳与中断恢复已贯通，见 [本轮交付](native-provisioning-handoff.md)。上游内容治理、Anchor Use、音频及对应失败恢复仍需迁移。
5. **采集入口交接**：TS 浏览器/YouTube、Agent 及后续端口通过统一接受规则进入本地库，验证幂等和隔离。
6. **正式原生产品界面**：承接 apps/web 的完整功能、状态与恢复体验，分别通过桌面/移动验收；目前仍是技术验收壳。

以上是工作分组，不是六个等量任务，也不承诺六次提交即可完成。
每个已存在 Web 用例都必须有“原实现依据 → 原生合同/实现 → 成功、失败、离线、重启恢复证据”的闭合记录，
内核扩展项不能只以单一轻量方式替代；完成这些才可称既有产品能力迁移完成。
浏览器插件和 Hono 在线服务保留 TypeScript，不要求把它们重写成 Rust。

**完整本地优先产品交付还需要**备份恢复、可选 E2EE 同步、必要的旧数据显式导入与分发/上线验收。
其中同步是新架构工作；图片/语音/全局采集等尚未存在的完整蓝图能力，也不能伪称为“已有 TS 待迁代码”。

## 高保证优先与 Profile 执行接线验收

Owner 已确认：先推进高保证完整路径，随后专门验收 Profile → 固定计划 → 注册策略/执行器 → 本地事务/Flutter 的实际连接。
现有 Profile/Registry 声明、纯队列行为对照不能替代该验收。必须验证改变已支持的策略绑定确实改变执行行为，
未知或不支持的组合明确阻塞，固定 Run 的版本不被普通设置改写；新增组合不能依赖通用内核中的 Profile 名称分支。
此项是迁移完成门，不能在高保证队列对照通过后删除。四阶段正式材料/UI 仍暂停。

2026-09-09：上述 Profile 执行接线门已通过本轮验证，具体策略行为、事务与平台证据见 [完整纵切记录](native-assurance-integration-handoff.md)。此完成状态仅覆盖已注册的轻量/高保证执行组合，不消除新组合、Policy Migration 或完整产品迁移的验收义务。

2026-09-09 源码盘点修正：Policy Migration 在领域模型中明确为未来能力，当前 Web/TS 没有对应执行实现；仍保留在完整产品蓝图，不计作已有 TS 成果的迁移欠账。在线语义解析/澄清与本地接受协作已完成本轮用例。个人意义显式入学、按需文本资源任务及校验/冻结材料化已完成，见 [交付记录](native-provisioning-handoff.md)。下一条已有功能纵切为 Anchor Use 原文授权/撤销、迟到结果隔离与后续材料替换。
