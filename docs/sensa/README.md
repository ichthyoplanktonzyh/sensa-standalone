# Sensa 文档索引

> 状态：Active index  
> 更新日期：2026-09-11

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

## 产品、架构与日常开发

目标架构遵循 [ADR 0001](../adr/0001-local-library-optional-encrypted-sync.md)、
[ADR 0002](../adr/0002-flutter-rust-local-core.md) 与 [ADR 0003](../adr/0003-three-client-local-facts.md)。
正式 Web 本机执行、原生迁移和旧 Consumer 路径的证据分别管理，不将迁移期服务端权威当作目标架构。

| 文档 | 用途 |
| --- | --- |
| [当前阶段](current-stage.md) | 当前工作重点、已验收范围与尚未关闭的门 |
| [产品需求](product-requirements-v1.md) | 信息架构、用户旅程、交互与功能范围 |
| [生产路线图](production-migration-plan.md) | 里程碑依赖、发布门与后续工作 |
| [开发约定](development-workflow.md) | 体验确认、复用、实施与交付规则 |
| [测试策略](testing-strategy.md) | 执行入口、真实/替身边界与测试条件 |
| [个人库事实模型](personal-library-fact-model.md) | 本地事实、版本、投影与 G1–G3 验收门 |
| [学习扩展架构](learning-extensibility-architecture.md) | 原型实现 seam 的设计参考；正式 Web 接线见学习包指南 |

## 功能与操作指南

| 文档 | 用途 |
| --- | --- |
| [Web 个人内容与本机学习](web-local-meaning-workflow.md) | 本机内容、澄清、资源准备、学习与恢复 |
| [学习包导入与运行](assurance-package-import.md) | borrow/lend 资源、高保证/轻量/四阶段接入与验收入口 |
| [模型执行](model-execution.md) | Genkit、默认服务、自定义直连、调度、观测与密钥边界 |
| [浏览器阅读与采集](browser-port-contract.md) | 当前阅读/字幕/保存行为、兼容约束、源码参考和测试入口 |
| [浏览器后续事项](browser-port-followups.md) | 尚未关闭的问题与兼容性范围，未自动排期 |
| [Web 发布核查](web-launch-readiness.md) | 发布候选、真实服务配置、检查与未关闭门；历史盘点不等于当前缺口 |
| [发布授权与前置](release-authorization.md) | 云端/商店操作所需的授权和产物 |
| [原生能力](native-capability-status.md) | 原生功能摘要、历史证据与未完成平台范围 |
| [原生迁移清单](native-migration-checklist.md) / [UI 验收矩阵](native-ui-acceptance-matrix.md) | 迁移范围、平台和体验验证边界 |
| [原生包导入合同](native-pack-import-contract.md) | 包格式与准入约束 |

## 保留的设计与兼容合同

这些文档包含仍需维护的状态、接口或迁移约束，不能因名称带阶段编号而删除；它们不覆盖最新
领域模型和 owner 已确认的产品变化。旧路径的实现细化、V01–V20 回归向量和测量预算集中在
[Consumer 兼容参考](consumer-compatibility-reference.md)。

- [首轮范围基线](first-round-product-baseline.md)：已确认范围的来源，当前优先级见当前阶段。
- [首次学习状态规格](m0-2-first-learning-state-spec.md)、[浏览器采集状态规格](m0-2-browser-capture-state-spec.md)。
- [Consumer v3 合同](m0-3-consumer-contract.md)、[迁移裁决](m0-3-migration-blueprint.md)、[采集与供给合同](m2-consumer-contract.md)。
- [本地库迁移蓝图](local-library-migration-blueprint.md)：本地职责、旧数据回退与同步设计门。

逐次 handoff、轮次优化报告、M0-3 施工任务表和 standalone 初始快照已移除。
有效内容已并入上述长期文档，旧原文的 Git 追溯方法见 Consumer 兼容参考。
不新增归档目录复制旧报告。历史通过结果不会因文档合并而升级为当前产品、真实服务或发布验收。

## 操作文档和参考材料

- [`../../apps/web-next/journeys/README.md`](../../apps/web-next/journeys/README.md)：当前阶段已冻结的两条
  canonical frontend narrative；只裁决 `web-next` 页面叙事，不能覆盖本目录领域模型；
- [`../../content/README.md`](../../content/README.md)：内容工具当前实际支持的命令与安全边界；
- [`../../apps/web/README.md`](../../apps/web/README.md)：Web 本地运行说明；
- [`../../infra/README.md`](../../infra/README.md)：基础设施边界；
- `docs/reference/bbdc/`：不背单词外壳参考；
- [`../reference/read-frog/product-review.md`](../reference/read-frog/product-review.md)：陪读蛙产品与扩展源码评估、可借鉴体验、YouTube 能力边界与后续用例建议；非实施合同；
- `docs/reference/sensa-v1/`：已接受的 Sensa V1 交互原型。

参考材料只能说明来源或帮助视觉检查，不能定义领域对象和运行所有权。
