# 高保证学习：Step 选择与定向修复

日期：2026-09-08。Owner 本轮明确调整优先级：四阶段只用于证明内核扩展性，正式材料/界面暂停；
现在优先处理高保证学习。四阶段尚未梳理完整的正式 UI 不再列为当前原生迁移完成的前置。

## 本轮范围

`crates/sensa-core/src/assurance.rs` 迁移正式 Web 高保证学习所用
`apps/web/src/experience/engine/stepOrchestration.ts` 的 structured_acquisition 与 structured_retention
规则，并对照 `review/types.ts` 的复习结果分类。具体包括：

- 首学 Introduction、按包声明的必需 Gate 顺序选择、重复 Gate 去重及候选间隔规则。
- 回想等测评优先避开上一任务；新语境迁移按 scenario index 轮换。
- 定向修复挂回失败的 Action，优先包内资源。首学保留源码中显式标记的 scheduler_fallback；
  **重学必须有 package_declared 修复引用**，没有就不产出 Step，不自造内容。
- instruction / assessment / repair 的意图及对应呈现类型由编排声明，修复的 taskKey 清空。
- 到期复习消费诊断优先能力和清单轮换；FSRS reps/lapses 不参与“考什么”的选择。
- 当前边界辨析仅作诊断，不自动产生完成 due Review 的 Memory Outcome；重学的复测可单独选择该能力。
- 高保证的动态 Checkpoint Definition 只包含包内 requiredCapabilities，不为缺省包添加空 Gate。

这些接口只返回 Step 定义或分类描述，不写 Evidence、Gate credit、Completion 或调度。
`Inventory` 是已验证清单的投影，并不是 Published Package 的入库校验器；原生普通文本包仍不满足结构化内容要求。

## 扩展边界与尚未迁移部分

候选键的排序通过宿主 comparator 注入。原 Web 使用 localeCompare；不能无说明地换成 Rust 字节序。
差分适配器将源 localeCompare 的排序提供给 Rust，验证选择与修复逻辑；**本轮没有迁移 ICU/平台 locale 排序**。
原生正式宿主需明确并固定排序合同，再接入完整队列。选出的候选以 index 返回，避免核心复制整个内容对象。

修复定义保留包内额外绑定字段；核心只修改本步骤负责的身份、意图、task 和失败来源。
这并不证明资源已被渲染、听音可用或行为评价已通过。当前高保证入口继续 blocked，不能自动降级到轻量。

完整 LearnQueue / ReviewQueue 的生命周期、帮助条件下的评价资格、Declared Mastery、撤销、
暂停恢复与 Outcome/调度事务、正式结构化材料入库和 Flutter AssuranceCard 尚待接入。
本轮未变更 SQLite schema、已有学习数据或 Flutter 产品行为，也没有恢复四阶段的正式 UI 施工。

## 验证

- `sensaNativeAssuranceParity.mts` 直接调用原 TS：2,170 组 fresh/repair/outcome 精确对照。
  使用合成变体及实际 Web 前三份材料清单；覆盖无动作/无修复资源、资源来源、任务轮换、
  额外绑定字段保留、间隔/同序候选、诊断优先、边界不可单独完成 Review 等情况。
- `assurance_orchestration.rs` 将高保证动态定义、current-checkpoint-reset 策略和通用 SQLite Journal 组合：
  识别通过 → 回想失败 → 包内桥接修复 → 新任务独立重测通过，每一步均重开磁盘库验证。
  回想失败时识别 credit 保留；修复后仍待重测，epoch 不发生整轮重置；旧记录保留。
- 上述组合使用合成 evaluator 输入，只验证内核/存储组合。没有把它当作正式学习 Evidence，
  并断言未产生应用 Memory/调度，不冒充高保证整条产品流程验收。

本轮新增源差分已纳入 `sensa:native-core-smoke`，既有规则差分与 SQLite 回归全部通过。
Clippy `--workspace --all-targets --locked -- -D warnings`、原生桥 `cargo check --locked`、
根级 `npm run typecheck` / `npm run build` / `npm run lint` 均通过。
本轮未做高保证 Flutter 平台验收；没有付费调用、数据迁移、推送或部署。

## 下一步

继续迁移高保证 LearnQueue 的 Gate 生命周期与评价约束，使其消费本轮选择器和已有进度账本；
随后以正式 Web AssuranceCard 为依据接入结构化材料、Action 与 Flutter 交互及离线恢复验收。
