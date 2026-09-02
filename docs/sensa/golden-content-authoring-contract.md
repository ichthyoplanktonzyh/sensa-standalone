# Sensa Golden Content Authoring Contract V1

> 状态：Active versioned implementation contract；不属于领域模型
> 日期：2026-08-28
> 领域来源：[sense-learning-resource-model.md](sense-learning-resource-model.md)
> 实现：`packages/contracts/src/sensa/authoring.ts`、`packages/content-validator/src/authoringBundleValidator.ts`

本文定义原型阶段如何把已确认的 Sense Learning Package 模型写成可执行、可校验的作者数据。
它只约束 Authoring Bundle，不定义 Learn、Review、Action、Evidence、Graduation 或 FSRS 运行行为。

## 一、Module 与唯一 Interface

Golden Content Authoring Module 隐藏 Zod 解析、跨资源引用、审核状态、Transfer 资产隔离和当前
delivery profile 完整性。外部只需要一个确定性 Interface：

```ts
validateGoldenContentBundle(input: unknown): SensaGoldenContentValidationResult
```

该函数不访问数据库、不调用模型或媒体服务，也不写运行状态。它只返回：

- `invalid`：结构、引用或隔离规则错误，不允许预览；
- `incomplete`：结构正确且可预览，但仍缺人工审核或当前交付要求；
- `satisfied`：Schema、审核和当前 delivery profile 均满足。

这条 Seam 把 Authoring Bundle 与未来 Published Snapshot、Runtime Action 分开。作者不直接编写
Action，客户端也不能把一次页面操作反写成内容事实。

## 二、Golden Content Bundle

`sensa-golden-content-bundle-v1` 由五类共享资源组成：

1. `sources`：词典、语料、编辑或生成证据；
2. `media`：图片、音频及其 URI、摘要和来源；
3. `lexemes`：词头、词形、音节和发音等共享 Lexeme 事实；
4. `relations`：跨 Sense 的边界关系；
5. `packages`：一个 Sense 对应一个版本化 Sense Learning Package。

Package 固定引用 Lexeme 版本，不复制共享词头事实。一个 Package 包含：Sense 事实、Acquisition
Profile、Experience Sketch、一个或多个 Experience Render、L1 Bridge、Learning Examples、Usage
Patterns、可选 Free Practice Manifest，以及逐资源 provenance/review。

## 三、Acquisition Profile 与 Render Plan

Authoring Profile 必须记录：

- `acquisitionNeeds` 与 `minimumSufficientExperience`；
- `distinguishingFeatures`；
- `preferredPrimitives` 与真正改变教学机制的 `fallbackPrimitives`；
- Graduation 前必须解决的 `requiredCapabilities` 与非门禁的 `optionalCapabilities`；
- Package 必须供给的 `requiredAssetCapabilities` 与可增强体验的 `optionalAssetCapabilities`；
- `domainBound/domainConstraints` 与经过 Relation 支持的 `boundaryTargets`。

Acquisition Primitive 是媒介无关的教学机制，不是 renderer kind。每个 Experience Render 必须声明
自己实现的 Primitive 与支持的 delivery profiles；该 Primitive 必须来自 Profile 的 preferred 或
fallback 集合。

`sensa-experience-render-plan-v1` 把每个 approved Render 恰好分类一次，并且恰好选择一个 preferred：

- `preferred`：优先采用，必须实现 Profile 的 preferred Primitive；
- `alternative`：仍能实现 Sketch 的等价替代；
- `fallback`：较丰富 renderer 不可用时的可靠路径。

每个角色内部使用稳定 `rank` 排序。preferred 为非文字 Render 时，当前原型 profile 要求一个明确
归类为 fallback 的 Text Experience Render；preferred 本身为 text 时不再制造重复 fallback。Render
Plan 不是 learner 要依次完成或逐层丰富的路径，也不属于 Runtime Action 顺序。

`requiredCapabilities` 与 `requiredAssetCapabilities` 不同：前者是 Acquisition Graduation 的能力
要求，后者是 Package 发布完整性声明。Validator 会报告缺少资源解析的 required Asset Capability，
但不会因为 optional Capability 缺失而阻止预览。

## 四、Experience Sketch 与 Render

Experience Sketch 描述学习者应形成什么预期，是媒介无关的教学意图。Render 是该意图的一种
具体呈现，两者不能合并。V1 Schema 支持：

- `text`：完整中文经验场景，字段为 `sceneL1`，可以独立完成 grounding；
- `image`：图片和中文无障碍替代文本；
- `sequence`：因果或时间序列，至少两个步骤；
- `interaction`：版本化 renderer 与 payload。

Text Experience Render 不是对 Sketch、图片或交互的文字说明，而是让 learner 能在脑中跟随角色、
状态、变化或因果关系的完整经验场景。同一个 Sketch 可以拥有多种 Render，但 Runtime 每次只沿
Render Plan 选择一条路径。所有 Experience Render 都必须隐藏目标词形；非文字 preferred 必须用一个
独立 Text Experience Render 作为 fallback。

当前 `rendererKey + payload` 是 Golden Authoring V1 为静态原型提供的实现合同，不是未来动态
Interaction Render 的 canonical 结构。后续方向已在资源模型中固定为 Sensa-owned、A2UI-inspired
的声明式 Interaction Render Contract：预生成与未来实时 AI 生成共用同一套闭集 Catalog、Schema
和 Validator，并用 provenance、review status 与 Evidence eligibility 区分可信级别。本合同暂不
引入该协议，也不开放实时 AI、任意代码、自由组件拼装或模型生成 grader。

目标词隐藏检查覆盖 Interaction payload 内的全部字符串叶子，不能把目标词藏进 renderer 参数或
无障碍文案。Image Render 必须引用 `image` media；发音与 Example audio 必须引用 `audio` media。

图片不是 URL 占位符。加入图片时必须同时提供：

1. `media` 中的真实 `mediaKey`、URI、MIME type 与 SHA-256；
2. 图片的 source/generator provenance 和审核状态；
3. `image` Render 的 `altTextL1`，以及 Render Plan 中独立的 Text Experience Render fallback；
4. 通过 Validator 的目标词隐藏、引用完整性和审核检查。

## 五、Example 角色与隔离

一个 Example 可以承担明确的角色：Study Binding、Recognition Assessment、Retrieval Repair、
Transfer Assessment、Retention Assessment 或 Free Practice。它同时声明：

- `learning_only`：可用于教学、修复或自由练习；
- `assessment_only`：只允许进入独立检验。

Transfer Example 必须是 `assessment_only`，且不得同时承担教学、修复、Recognition 或 Free
Practice 角色。Free Practice Manifest 引用 assessment-only 资源时，整个 Bundle 直接判为
`invalid`。

当前 `sensa-web-prototype-acquisition-v1` delivery profile 要求每个 Package 至少具备：

- Contextual Recognition、Meaning-to-form Recall、Novel-context Transfer 三项基线要求；
- 1 个 Study Binding Example；
- 1 个 Recognition Example；
- 5 个受保护 Transfer Examples，覆盖至少 3 个 scenario families；
- 一个 preferred Experience Render；若它不是 text，则另有显式 Text Experience Render fallback。

这些数量是当前原型交付约束，不是 Sense 或学习理论的永久定义。

## 六、首个 tracer：fragile / 易碎的

作者数据位于 `apps/web-next/src/content/fragileGoldenBundle.ts`，对应物理义项：

> Easily broken, not sturdy; of delicate material.

词典事实固定引用本地 `senses.db` 中 `fragile-dict-002` 的 Wiktionary 快照和 digest。教学内容明确
记录为 OpenAI 辅助起草、等待人工审核，因此 Validator 返回 `incomplete + previewable`，不会被
误标成 approved release。

当前 Package 包含：

- 1 个媒介无关 Experience Sketch；
- 1 个中文文字 Render；
- 1 个真实生成图片 Render；
- 1 个“完好 → 轻微碰撞 → 裂纹 → 小心处理”的因果序列 Render；
- 1 个可由 `state_change_v1` 实现的碰撞力度 Interaction Render；
- 1 个 L1 Bridge；
- 1 个 Study/Repair/Free Practice Example；
- 1 个独立 Recognition Example；
- 5 个 assessment-only Transfer Examples；
- 1 个 Usage Pattern；
- 仅开放 `immersive_browse` 与 `quick_spelling` 的初版 Practice grants。

该 Profile 把 `causal_sequence` 设为 preferred Primitive，把 `visual_grounding` 设为 pedagogical
fallback Primitive。Render Plan 的实际顺序为：Interaction 是 preferred；因果 Sequence 与 Image
是 alternatives；Text 是 delivery fallback。学习者不需要依次看完四种 Render。

图片本地资产位于被 Git 忽略的
`content/data/media/images/fragile/experience-physical-care-v1.png`，尺寸为 1254×1254，包内使用
content-addressed URI 与 SHA-256 固定其身份；生成 prompt 记录在
`content/prompts/fragile-experience-image-v1.md`。仓库不提交运行媒体，未来由内容发布流程上传并
把 content-addressed URI 解析到 R2。

包中仍没有真实音频，因此不声明 portable listening 或 dictation。后续加入这些能力时，应新增
真实 Media Definition 与对应 Example/Pronunciation Render，而不是修改 Sketch 来迁就媒介。

## 七、验证入口

```bash
npm run sensa:golden-content-smoke
```

Smoke 证明草稿包可预览，并校验图片 digest、四类 Render、preferred/fallback 选择、Transfer 隔离、
Example target span、media kind、Primitive 授权、fallback 完整性与 required Asset Capability 缺失报告。
