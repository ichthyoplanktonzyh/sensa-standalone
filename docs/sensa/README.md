# Sensa 文档索引

> 状态：Active index  
> 更新日期：2026-09-04

本目录不再把所有设计记录都当作“领域模型”。文档按职责分层；下层文档不能覆盖
上层文档的定义。

## 领域模型

以下七份文档共同构成 Sensa 的领域模型：

| 文档 | 唯一职责 |
| --- | --- |
| [`../../CONTEXT.md`](../../CONTEXT.md) | 统一语言与产品边界 |
| [`production-architecture.md`](production-architecture.md) | 领域总图、聚合、Account/Settings/Data Control、Curriculum/Personal Content 生命周期、Lexical Reference、语义投影、自由练习、模块边界和全局不变量 |
| [`personal-semantic-world-model.md`](personal-semantic-world-model.md) | 个人意义、经验/表达锚点、LLM 语义访谈、按需 Sense 构造、确认门与中英首版边界 |
| [`learning-connection-model.md`](learning-connection-model.md) | 独立 Book/direct/personal-first learning entries 与 Learning Entry Provenance、Learning Target/Capability Objective/Retention Target、learner-selectable Learning Policy、Resolved Learning Plan、published/on-demand/hybrid 内容供给、三种 Protocol Purpose、Protocol Step/Checkpoint/Card 边界、Profile 策略组合、学习结果、graded Memory Outcome、Relearning scheduler 资格与 FSRS Scheduling Handoff |
| [`semantic-acquisition-model.md`](semantic-acquisition-model.md) | Structured Acquisition Protocol 的 Gates、五维诊断、Semantic Field、Lexical Reference 支架与四种练习通道理论 |
| [`sense-learning-resource-model.md`](sense-learning-resource-model.md) | Published/On-demand 学习内容、Materialization、教学/检验/练习资源、Reference Lexicon 与发布语义 |
| [`learning-runtime-model.md`](learning-runtime-model.md) | Account/Preferences/Data Control、Curriculum/Personal Content lifecycle、Learning Policy Assignment/plan readiness、Contextual Lookup、Unified Planning、Protocol Run/Step、Attempt→Observation→Evidence→Transition、Checkpoint/Progress Reset、正式 Session/Encounter/Outcome、Free Practice 与 FSRS 的运行关系 |

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

这些文档仍有用途，但不属于领域模型：

| 状态 | 文档 | 职责 |
| --- | --- | --- |
| Canonical stage | [`current-stage.md`](current-stage.md) | 当前里程碑、证据级别和交付边界 |
| Canonical product | [`product-requirements-v1.md`](product-requirements-v1.md) | V1 IA、用户旅程和交互验收 |
| Active plan | [`production-migration-plan.md`](production-migration-plan.md) | 从本地纵切到公开 V1 的剩余工作 |
| Active decomposition | [`learning-extensibility-architecture.md`](learning-extensibility-architecture.md) | `web-next` 学习扩展性的实现 seam；把领域已有的显式 retention scope 扩展规定落到实现层，不新增领域定义 |
| Current implementation | [`content-kernel-contract.md`](content-kernel-contract.md) | 当前数据库与 V3 package validator 实现快照；尚未证明新 Gate capability coverage |
| Pre-redesign contract | [`curriculum-runtime-contract.md`](curriculum-runtime-contract.md) | 当前 vertical slice 的 Curriculum/Runtime 持久化事实，等待 Acquisition Cycle 版本替换 |
| Pre-redesign packet | [`runtime-rule-packet-v2.md`](runtime-rule-packet-v2.md) | 当前 Encounter 的可重放规则；首次 retrieval 即初始化 FSRS，不代表新 canonical runtime |
| Frozen legacy | [`runtime-rule-packet-v1.md`](runtime-rule-packet-v1.md) | 历史 V1 Encounter 的可重放规则 |
| Pre-redesign contract | [`sensa-sync-contract.md`](sensa-sync-contract.md) | 当前 Sync v1/v2 wire facts；新 Cycle/Gate/Session intent 需要新版本 |

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
- `docs/reference/sensa-v1/`：已接受的 Sensa V1 交互原型。

参考材料只能说明来源或帮助视觉检查，不能定义领域对象和运行所有权。
