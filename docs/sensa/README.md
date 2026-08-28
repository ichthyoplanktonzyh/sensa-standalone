# Sensa 文档索引

> 状态：Active index  
> 更新日期：2026-08-28

本目录不再把所有设计记录都当作“领域模型”。文档按职责分层；下层文档不能覆盖
上层文档的定义。

## 领域模型

以下五份文档共同构成 Sensa 的领域模型：

| 文档 | 唯一职责 |
| --- | --- |
| [`../../CONTEXT.md`](../../CONTEXT.md) | 统一语言与产品边界 |
| [`production-architecture.md`](production-architecture.md) | 领域总图、聚合、Account/Settings/Data Control、Curriculum/Personal Content 生命周期、Lexical Reference、语义投影、自由练习、模块边界和全局不变量 |
| [`semantic-acquisition-model.md`](semantic-acquisition-model.md) | 双层学习理论、Semantic Field、Acquisition Gates、五维诊断、Lexical Reference 支架与四种练习通道的含义 |
| [`sense-learning-resource-model.md`](sense-learning-resource-model.md) | 一个 Sense 的教学/检验/练习资源、Reference Lexicon/Lexical Enrichment、Semantic Field、能力覆盖和发布语义 |
| [`learning-runtime-model.md`](learning-runtime-model.md) | Account/Preferences/Data Control、Curriculum/Personal Content lifecycle、Contextual Lookup、Unified Planning、正式 Session/Encounter/Outcome、Free Practice 与 FSRS 的运行关系 |

发生冲突时，先用 `CONTEXT.md` 确认术语，再由
`production-architecture.md` 确认对象边界；资源问题由
`sense-learning-resource-model.md` 裁决，运行行为由
`learning-runtime-model.md` 裁决。理论文档解释设计理由，但不能直接新增数据库字段、
固定页面顺序或发布配额。

领域模型同时覆盖四条职责不同的产品链：正式 Acquisition/Retention、Reference Lexicon 与
Contextual Lookup、基于 published Semantic Fields 的 Learner Semantic Projection，以及与正式证据链
隔离的 Free Practice。当前 PRD 可以分阶段交付这些能力，但实现合同不能把尚未交付的词典、个人
内容或练习原型冒充领域事实。

四条产品链共同依赖一个支持边界：Account 负责访问与生命周期，Learner 负责学习事实，typed
Learner/Device Preferences 负责未来呈现选择，Data Control 负责导出/删除。Settings Surface 只是
组合入口，不是第五条学习链或通用状态聚合。

## 其他当前文档

这些文档仍有用途，但不属于领域模型：

| 状态 | 文档 | 职责 |
| --- | --- | --- |
| Canonical stage | [`current-stage.md`](current-stage.md) | 当前里程碑、证据级别和交付边界 |
| Canonical product | [`product-requirements-v1.md`](product-requirements-v1.md) | V1 IA、用户旅程和交互验收 |
| Active plan | [`production-migration-plan.md`](production-migration-plan.md) | 从本地纵切到公开 V1 的剩余工作 |
| Current implementation | [`content-kernel-contract.md`](content-kernel-contract.md) | 当前数据库与 V3 package validator 实现快照；尚未证明新 Gate capability coverage |
| Pre-redesign contract | [`curriculum-runtime-contract.md`](curriculum-runtime-contract.md) | 当前 vertical slice 的 Curriculum/Runtime 持久化事实，等待 Acquisition Cycle 版本替换 |
| Pre-redesign packet | [`runtime-rule-packet-v2.md`](runtime-rule-packet-v2.md) | 当前 Encounter 的可重放规则；首次 retrieval 即初始化 FSRS，不代表新 canonical runtime |
| Frozen legacy | [`runtime-rule-packet-v1.md`](runtime-rule-packet-v1.md) | 历史 V1 Encounter 的可重放规则 |
| Pre-redesign contract | [`sensa-sync-contract.md`](sensa-sync-contract.md) | 当前 Sync v1/v2 wire facts；新 Cycle/Gate/Session intent 需要新版本 |

实现合同描述当前代码或历史事实，不自动成为永久领域规律。2026-08-27 接受的 Acquisition
Cycle 模型高于 pre-redesign contracts；新实现必须通过新的 versioned contracts 落地，不能
静默重解释旧 Encounter。当前 validator 的例句数量仍只是 V3 delivery profile，而不是
`Sense` 或 Acquisition Gate 的定义。

## 操作文档和参考材料

- [`../../content/README.md`](../../content/README.md)：内容工具当前实际支持的命令与安全边界；
- [`../../apps/web/README.md`](../../apps/web/README.md)：Web 本地运行说明；
- [`../../infra/README.md`](../../infra/README.md)：基础设施边界；
- [`../migration-foundation.md`](../migration-foundation.md)：standalone baseline 的实现快照；
- `docs/reference/bbdc/`：不背单词外壳参考；
- `docs/reference/sensa-v1/`：已接受的 Sensa V1 交互原型。

参考材料只能说明来源或帮助视觉检查，不能定义领域对象和运行所有权。
