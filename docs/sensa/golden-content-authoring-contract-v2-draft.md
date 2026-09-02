# Golden Content Authoring Draft V2

> 状态：Experimental draft；用于由高保真学习链路反推资源合同
> 日期：2026-08-28
> 上位模型：[`sense-learning-resource-model.md`](sense-learning-resource-model.md)、
> [`learning-runtime-model.md`](learning-runtime-model.md)
> 兼容基线：[`golden-content-authoring-contract.md`](golden-content-authoring-contract.md)

本文定义下一组 Golden Package 共用的可推翻作者合同。它不替换 V1，不是数据库、HTTP、Sync、
Runtime Action 或最终 Published Package wire contract。Draft V2 的用途是让不同 Sense 使用同一资源
语言完成 `Experience → Reveal → Acquisition → Retention Review → Repair`，再根据实际例外修订。

## 1. 唯一外部 Interface

Draft V2 authoring/preview 只暴露一个确定性 Interface：

```ts
validateGoldenContentDraftV2(input: unknown): SensaGoldenContentDraftV2ValidationResult
```

该 Module 隐藏结构解析、V1 基线投影、跨资源引用、target-form 泄露、Example/Transfer 隔离、
Assessment capability coverage、Repair binding、Usage Example exact-span 校验和审核状态。它不访问
数据库、网络、模型或 TTS，也不选择当前 Action。

结果继续使用：

- `invalid`：结构、引用、隔离或语义资格确定性错误；
- `incomplete`：可以预览，但存在 draft review 或 delivery coverage 缺口；
- `satisfied`：当前 Draft V2 delivery profile 全部满足。

## 2. Bundle 与 Package 总图

```text
Golden Content Draft V2 Bundle
├── sources
├── media
├── lexemes
├── relations
└── packages
    └── Sense Learning Package Draft V2
        ├── identity
        ├── sense
        ├── acquisitionProfile
        ├── experience
        │   ├── sketch
        │   ├── renders
        │   ├── renderPlan
        │   └── recap
        ├── l1Bridge
        ├── examples
        ├── usagePatterns
        ├── assessmentInventory
        ├── repairBindings
        ├── optional practiceManifest
        └── provenance
```

Draft V2 复用 V1 的 Source、Media、Lexeme、Sense Relation、Acquisition Profile、Experience Sketch、
Experience Render、Render Plan、L1 Bridge 和 provenance 定义。新增对象不能把 Card、当前 Action、
learner exposure、Gate、5D、Memory Outcome 或 FSRS 写入内容。

### 2.1 验证包不等于生产任务单元

本轮由一个独立 authoring worker 端到端生成少量 Golden Package，只用于验证合同能否被完整消费、
跨资源引用能否闭合，以及不同 Sense 是否会暴露新的合同缺口。它不是未来的大规模生产方式。

规模化生产时，完整 Package 应拆成可独立生产和审核的资源族，例如 Experience、L1 Bridge、
Learning/Usage Examples、Assessment、Boundary/Repair 与 provenance/QA；不同 producer 可以并行产出，
再由确定性的 composer 按稳定 identity 合成 Package，并通过同一个完整 Bundle validator 验收。
因此：

- 完整 Package 是组合与发布验收边界，不是单个 worker 的所有权边界；
- 每项资源必须自带稳定 identity、provenance 和 review state，不能依赖同一生成上下文中的隐含信息；
- 跨资源连接必须使用显式 typed reference，不能依赖数组位置、文本搜索或 producer 私有约定；
- 本 Draft 暂不定义生产队列、fragment wire contract、composer API 或多代理编排，待 Golden 验证暴露
  实际拆分缝隙后再冻结。

### 2.2 Web-next MVP runtime 投影

`web-next` 不直接读取本 Authoring Bundle。MVP 使用确定性 compiler 将通过 Draft V2 validation 的
Bundle 投影为版本化 runtime learning release JSON；compiler 只保留客户端执行 Learn、Review、
targeted Repair 与 Free Practice 所需的已审核资源和显式引用，不携带 `sources`、provenance、生成/
审核治理信息，也不携带 learner state、当前 Action、Evidence、5D projection、Memory Outcome 或 FSRS。

客户端通过 Learning Catalog 安装 release、按 `packageKey` / `senseId` 查询 Package，并以 fail-closed
方式解析媒体和任务引用。Learn 与 Review 调度只消费该 Catalog，不回读 authoring fixture，也不把
runtime release 当成数据库迁移包。该 JSON、compiler 和 validator 目前只构成前端 MVP 的可替换 seam；
它们验证消费边界和确定性，不冻结 production Published Package wire contract。

## 3. Experience Recap

`experience.recap` 是 Reveal 与 repair 使用的 learner-facing 回顾，不是把内部 Experience Sketch
原样展示给 learner：

```text
recapKey
titleL1
steps[]:
  stepKey
  labelL1
  descriptionL1
bodyL1
provenance
```

要求：

- 至少两个有序 step；
- 全部 learner-facing 字符串隐藏 lemma 与合法 forms；
- Recap 概括同一个 Sketch 的 minimum sufficient experience，不得引入新的 Sense；
- Reveal 可以显示 Recap，Adaptive Repair 可以引用它；展示 Recap 不产生 Evidence。

## 4. Learning Example Draft V2

Example 继续固定 immutable L2/L1 text、exact target occurrence、Sense binding、scenario family、
construction、Renders、visibility 和 provenance。Draft V2 扩展 role 闭集：

```text
study_binding
recognition_assessment
retrieval_repair
transfer_assessment
retention_assessment
usage_illustration
free_practice
```

`usage_illustration` 只表示 Example 获准被 Usage Example Binding 引用。它必须是 `learning_only`，
不能把 protected Transfer 资源暴露给 Reveal、Example carousel 或 Free Practice。

本轮 TTS 直接使用现有 Media/Render 结构，不新增一套 TTS 子合同：Lexeme 发音通过
`pronunciation.mediaKey` 引用 audio Media，学习例句通过 `static_audio` Render 引用 audio Media。
Golden Draft V2 只为 `learning_only` 例句生成音频，`assessment_only` 素材不生成、不暴露。

## 5. Usage Pattern 与 Usage Example Binding

Usage Pattern 不再保存无法导航的 `string[]`。每个可显示 collocation 必须拥有稳定 identity 和至少一条
exact Example binding：

```text
UsagePattern
  patternKey
  canonicalPattern
  registerLabel?
  domainLabel?
  usageRestriction?
  collocations[]
    collocationKey
    displayTextL2
    exampleBindings[]
      bindingKey
      exampleKey
      start
      end
      role: primary | alternative
  provenance
```

Validator 必须证明：

- `textL2.slice(start, end) === displayTextL2`；
- Example 存在、为 `learning_only` 且拥有 `usage_illustration` role；
- 每个 collocation 恰好一个 `primary`，可以有多个 `alternative`；
- identity、binding 和 span 不依赖数组位置、substring search 或页面索引；
- assessment-only Example 永远不能成为 Usage Example Binding target。

未来 AI/editorial text 与影视/YouTube Attested Usage 使用相同 Example identity 和 Binding。媒体升级
只新增 approved Example Render；V1 Draft 不要求 synced media、clip timeline 或外部媒体授权链。

## 6. Assessment Task Resource

`assessmentInventory` 保存不可变、reviewed 的任务资源；Semantic Policy 决定何时选哪一个，Action
决定当前资源与 scaffold，客户端 Renderer 只消费物化后的 payload。

Inventory 中每个 kind 都是可扩展资源池，不是“一种卡固定一题”。Validator 只校验 required
capability 的最低覆盖、隔离和资源质量，不得把 Recall、Recognition 或其他 kind 限制为恰好一项。

每个 Task 共有：

```text
taskKey
kind
eligiblePurposes[]: acquisition_gate | retention_review | relearning_gate
promptL1
provenance
```

`eligiblePurposes` 是资源资格，不是 learner 路径。选项顺序、当前 masking、novelty、support level 和
本次 Outcome 仍由 Runtime 派生。

### 6.1 Contextual Recognition Task

```text
kind: contextual_recognition
exampleKey
questionL1
options[]:
  optionKey
  labelL1
  detailL1?
  isCorrect
  reasonCode
  feedbackTitleL1
  feedbackBodyL1
featureLabelsL1[]
```

要求 exactly one correct option；Example 必须拥有 Recognition 或 Retention role。Sense-specific
distractor 与逐项 feedback 属于内容，通用标题、按钮和 Outcome label 属于 Renderer catalog。

### 6.2 Meaning-to-form Recall Task

```text
kind: meaning_to_form_recall
cue:
  bodyL1
  featureLabelsL1[]
gradingContract: lexeme_identity_v1
supportInventory:
  firstLetter: boolean
  formChoices[]:
    optionKey
    formL2
    isTargetLexeme
    reasonCode
feedback:
  independentSuccessTitleL1 / BodyL1
  supportedSuccessTitleL1 / BodyL1
  choiceSuccessTitleL1 / BodyL1
  repairTitleL1 / BodyL1
```

Cue 与 feature labels 必须隐藏全部 target forms。合法 forms 来自 pinned Lexeme Version，不在 Task
复制。`firstLetter` 和 form choices 只是 available support；Policy 决定是否开放，得到支持不冒充
independent Recall。

### 6.3 Novel-context Transfer Task

```text
kind: novel_context_transfer
exampleKey
scene:
  sceneLabelL1
  setupL2
  setupL1
  visualKind
  visualAltL1
questionL1
options[]:
  optionKey
  labelL1
  detailL1
  isCorrect
  reasonCode
  feedbackTitleL1
  feedbackBodyL1
connectionSummary:
  fromLabelL1
  toLabelL1
  invariantLabelsL1[]
successTitleL1
successBodyL1
```

`setupL2/setupL1/visualAltL1/question/options` 在提交前全部隐藏 target forms；`exampleKey` 指向
`assessment_only + transfer_assessment` Example，提交后才可 Reveal。Task 对 learner 是否仍 novel
不属于 Package，由 exposure history 决定。`visualKind` 是 Draft delivery profile 的 closed renderer
key，不是永久领域枚举；必须同时有完整文字场景。

### 6.4 Boundary Contrast Task

```text
kind: boundary_contrast
relationKey
exampleKey
questionL1
options[] // 与 Recognition 相同的 reviewed choice + feedback shape
```

Boundary Task 必须引用真实 Sense Relation，Relation 必须涉及当前 Sense，Example 必须能判定 Relation
所表达的 distinction。没有真实 Relation 的 Package 必须省略；不得把 UI catalog preview 写入
Package 或 Evidence-eligible inventory。

## 7. Repair Asset Binding

Repair Binding 只声明“此能力/失败依据有哪些 approved 资源可用于修复”，不规定当前顺序：

```text
bindingKey
capability:
  grounding
  | contextual_recognition
  | meaning_to_form_recall
  | novel_context_transfer
  | boundary_discrimination
reasonCodes[]
strategyKind:
  grounding_replay
  | meaning_clarification
  | form_rebinding
  | varied_context_repair
  | boundary_clarification
resourceRefs[]:
  experience_recap(recapKey)
  experience_render(renderKey)
  l1_bridge(assetKey)
  learning_example(exampleKey)
  sense_features
  lexeme_forms
  sense_relation(relationKey)
provenance
```

默认 repair 直接复用当前 Package 已有资源：grounding 使用 Experience/Reveal，Recognition 使用 Task
feedback 与学习例句，Recall 使用 support inventory 与 pinned Lexeme forms，Transfer 使用 Task feedback、
Experience 与新的 assessment opportunity，Boundary 使用 Task 与真实 Relation。这些路径可由 Package
结构和当前 Action 确定性推导，不要求作者为每个 capability 重复声明 Binding。

只有某个 failure basis 需要偏离默认路径或选择特定资源时，才作者化显式 Repair Binding。任何已声明
Binding 的引用仍必须完整校验；其中 Example 必须是 `learning_only + retrieval_repair`，Boundary override
引用的 Relation 必须真实且涉及当前 Sense。Repair completion 不产生独立 success Evidence，后续重测
由 Runtime 在另一 Encounter 中安排。

## 8. Draft V2 发布/预览门禁

除 V1 基线外，Draft V2 Validator 至少验证：

1. 每个 baseline required capability 有 acquisition-eligible Assessment Task；
2. standard Package 有至少 5 条 Transfer Task/Example 配对，覆盖至少 3 个 scenario families；
3. Recognition/Transfer/Boundary options exactly one correct，option/reason identity 唯一；
4. Recall cue 与 support prompt 不泄露 target forms，form choices 恰好一个 target Lexeme；
5. Transfer pre-submit scene 不泄露 target forms，且只引用 protected Example；
6. required Boundary 有 Relation-backed executable Task；非 Boundary Package 可以零 Boundary Task；
7. 默认 repair 可以从 Package 资源确定性推导；任何可选 Repair Binding 都必须引用合法、类型匹配的
   teaching resources，不能因缺少可选 override 判定 Package 不可执行；
8. Experience Recap 和所有资源引用存在、类型匹配且 provenance 可审核；
9. 每个 displayed collocation 有 exact、learning-visible、usage-approved Example Binding；
10. Draft review 返回 `incomplete + previewable`；rejected、引用错误或资产泄露返回 `invalid`；
11. Validator 的 issue code、path、message 与排序稳定，可确定性重放；
12. V2 validator 可以内部复用或投影到 V1 validator，但外部 caller 只学习一个 Interface。

## 9. Golden diversity matrix

首轮 Draft V2 使用四个 Package 压测合同，不把资源质量误当发布质量：

| Sense | 压力面 | 预期 Primitive / 特殊资源 |
| --- | --- | --- |
| `fragile · 实体容易破损` | concrete physical adjective、low Boundary need | causal sequence、interaction-ready grounding、Usage bindings |
| `sustain · 使过程持续` | abstract process verb、forms、varied constructions | temporal/causal sequence、process invariant、Recall form grading |
| `borrow · 暂时取得并归还` | viewpoint-sensitive social transfer | social micro-scenario、cross-word Boundary to `lend` |
| `lend · 暂时交给他人并收回` | inverse viewpoint、real confusion target | social micro-scenario、cross-word Boundary to `borrow` |

所有内容先使用 `draft` review 与明确 AI/editorial provenance。它们是 contract probes，不得标记为
approved release 或学习效果证据。首轮不生成付费音频、TTS、影视/YouTube 媒体或 runtime AI 题目。

## 10. 冻结前验收

- 四个 Package 均通过同一个 Draft V2 Validator 且可预览；
- Renderer 所需 Sense-specific copy 均可从 Package/Action 取得；
- 不新增 `if lemma === ...`、example index 或 substring navigation；
- `fragile` 无 Boundary Task，`borrow/lend` 有 Relation-backed Boundary；
- protected Transfer、Usage Example 与 Free Practice inventory 保持 fail-closed；
- 同一资源库存可以支持 Acquisition、Retention Review 与 targeted Repair；
- 发现的例外先记录并修订 Draft，不把 Draft V2 静默升级为 production contract。
