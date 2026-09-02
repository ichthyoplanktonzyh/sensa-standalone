# 前端旅程基线：Personal Meaning → 已确认 Sense（及 Expression Binding 入口）

> 状态：web-next 主链原型已实现并通过代码审核
> 日期：2026-09-01
> 实施阶段：`web-next` 前端先行、后端契约发现

## 1. 任务目标

本阶段在以下仓库中实现第一条完整、可演示、可刷新恢复的前端用户旅程：

```text
Personal Meaning
→ 澄清并接受 Meaning Focus
→ Sense Construction
→ 查看、继续澄清或拒绝 Sense Proposal
→ learner 明确确认 Sense Proposal
→ stable Sense + immutable initial SenseVersion
→ Personal Meaning Alignment
```

Sense 确认是 Meaning Formation 的终点。之后可以从独立的 Confirmed Sense 详情进入下一条
Expression Binding 旅程：

```text
Confirmed Sense detail
→ 选择/编辑 proposal expression candidate
→ 明确 relation + semantic coverage
→ 确认 Expression Binding 或暂不绑定
→ 返回 Confirmed Sense detail
```

本轮最远只到 Expression Binding。Add-to-Learning、LearningTarget、Content Provisioning、
Curriculum、学习活动、Evidence、Memory State 与 FSRS 均不属于本旅程，也不能由这些页面触发。

仓库绝对路径：

```text
/Users/shadow/.codex/worktrees/e546/sensa-standalone
```

这是一项前端实现和 API 契约发现任务。不要实现后端，不要连接真实 API，不要调用真实 LLM，
不要进入 Content Provisioning、Add-to-Learning、Curriculum、LearningTarget、学习活动、Evidence、
Memory State 或 FSRS。

## 2. 工作区安全规则

当前是一个已经包含大量未提交改动的共享 worktree。你不是唯一在这个代码库中工作的执行者。

- 开始前运行 `git status --short` 和相关文件的 `git diff`，理解并保留现有工作。
- 不得还原、覆盖、格式化或删除不属于本任务的改动。
- 不得使用 `git reset --hard`、`git checkout --`、`git clean` 等破坏性命令。
- 不得自行 commit、merge、rebase、push 或创建/切换分支。
- 若现有实现与本任务冲突，以本任务列出的 canonical 文档与领域不变量为准；采用局部迁移，
  不得顺手清理整个旧前端。
- 所有旧代码都只是迁移输入，不是产品或领域事实来源。

## 3. 实施前必须完整阅读

按以下顺序完整阅读：

1. `/Users/shadow/.codex/worktrees/e546/sensa-standalone/AGENTS.md`
2. `/Users/shadow/.codex/worktrees/e546/sensa-standalone/CONTEXT.md`
3. `/Users/shadow/.codex/worktrees/e546/sensa-standalone/docs/sensa/README.md`
4. `docs/sensa/current-stage.md`
5. `docs/sensa/product-requirements-v1.md`
6. `docs/sensa/personal-semantic-world-model.md`
7. `docs/sensa/semantic-acquisition-model.md`
8. `docs/sensa/production-architecture.md`
9. `apps/web-next/FRONTEND_FIRST_WORKFLOW.md`
10. 现有契约：
    - `packages/contracts/src/sensa/personalSemanticWorld.ts`
    - `packages/contracts/src/sensa/semanticRegistry.ts`
11. 当前入口与相关实现：
    - `apps/web-next/src/App.tsx`
    - `apps/web-next/src/components/SensaSemanticWorldScreen.tsx`
    - `apps/web-next/src/components/PersonalMeaningComposer.tsx`
    - `apps/web-next/src/components/SemanticMapView.tsx`
    - `apps/web-next/src/contentProjection.ts`
    - `apps/web-next/src/services/personalContentService.ts`
    - `apps/web-next/src/index.css`

不要把以下内容作为实现依据：`docs/sensa/semantic-learning-loop.md`、`content/experiments/`、
旧 Cards/Decks/flashcard sync、Workspace 产品界面或其他已废弃原型报告。

## 4. 已存在且必须保留的行为

当前 `web-next` 已经完成 Personal Meaning 的创建入口迁移：

- 创建只要求“熟悉表达”或“具体经历”至少一项；target-language 表达不是创建前提。
- 创建后立即得到稳定的 `personalMeaningId`。
- 熟悉表达成为 `Personal Expression Anchor`；具体经历成为 `Personal Semantic Anchor`。
- 新创建项目在个人语义世界中显示“待澄清”。
- 旧 localStorage 草稿中的 L2 pin 只作为 legacy candidate 被保留，不能显示成已确认表达或
  Personal Meaning identity。

本任务从已有 Personal Meaning 进入详情开始。允许为旅程需要局部重构上述文件，但不能破坏这些
行为，也不能重新要求用户先输入英语单词。

## 5. 领域边界与硬性不变量

### 5.1 三种 identity 必须分开

```text
Personal Meaning ≠ Sense ≠ Expression
```

- Personal Meaning 是 learner 主动保留的个人意义 identity。
- Sense 是脱离私人原始对话后仍可复现、引用和版本化的意义区别。
- Expression 是特定语言中的 word、phrase、construction、sentence 或 utterance strategy。
- 禁止在文案、类型或状态中表达 `中文 = 英文`、`Personal Meaning = 单词` 或 `Sense = 单词`。

### 5.2 三个用户意图必须分开

1. **接受 Meaning Focus**：只确认当前关注的意义侧面。
2. **确认 Sense Proposal**：创建或复用 stable Sense、精确 SenseVersion，并创建
   Personal Meaning Alignment。
3. **确认 target-language expression**：单独创建或接受 Expression 及其
   Sense Expression Binding。

第三步不是第二步的前置条件。用户可以确认 Sense，但暂时没有自然的英语表达；界面必须允许
稳定停留在“Sense 已确认，表达待确认/暂无合适表达”。不得为了完成流程强迫选择单词。

### 5.3 事实、过程与投影状态必须分开

- Meaning Focus 的 learner 接受必须保存为显式 acceptance fact，而不是仅把页面 step 改为完成。
- Sense Proposal 是可修改 suggestion，不是 Sense。
- 只有显式确认 proposal 才能产生 confirmation fact、Sense、SenseVersion 与 Alignment。
- Expression Binding 也必须有独立 confirmation fact。
- `active / paused / completed / abandoned` 属于 Sense Construction 生命周期；
  `open / superseded / confirmed / rejected` 属于 Proposal 生命周期。
- 页面显示阶段只能由上述事实推导，不能保存成一个万能 domain `status` 并让它取代事实。

### 5.4 确认之后仍然没有发生学习

Sense 确认、表达确认、查看内容或点击按钮都不能产生以下任何东西：

- LearningTarget / RetentionTarget
- Content Provisioning decision / Learning Materialization
- Add-to-Learning Intent / Curriculum membership
- Learning Evidence / completion
- FSRS Memory State
- “已学会”“已掌握”“学习中”等产品文案

本任务的最远终点是 Alignment 以及可选的 Expression Binding。

### 5.5 隐私与不可变边界

- Personal Anchors、原始叙述、图片、录音、聊天原文保持 learner-private。
- mock SenseVersion 只保存可复现的抽象语义边界，不复制私密原文或个人身份信息。
- 修改/删除 Anchor 不得替换 `personalMeaningId`，也不得原位改写已确认 `senseVersionId`。
- 同一经验未来可以拆成多个 Focus；数据结构和 UI 至少应支持并展示这一可能性。

## 6. 必须实现的用户旅程

### 6.1 从个人语义世界进入详情

- Personal Meaning 的列表项、卡片或地图节点提供明确、可键盘操作的“查看/继续澄清”入口。
- 进入独立详情视图；浏览器回退或应用内返回能够回到原来的个人语义世界上下文。
- 详情至少展示：稳定 identity 的可辨识短 ID、当前显示名/个人意图、熟悉表达 Anchors、经验
  Anchors、Meaning Focus、已确认 Alignments，以及由事实推导的当前旅程阶段。
- 不需要暴露完整 UUID 给普通用户；短 ID 可以放在次要信息位置。

### 6.2 编辑 Anchors

- 用户可以独立新增、编辑或移除熟悉表达 Anchor 和文本型经验 Anchor。
- 首版无需实现真实图片/音频上传；可在 UI 中明确说明尚未支持，而不是伪造上传成功。
- 每次编辑产生新的 mock revision，保持 anchor identity 稳定。
- Anchor 编辑不能自动接受 Focus、确认 Proposal、确认 Sense 或绑定 Expression。

### 6.3 提议、编辑、拆分并接受 Meaning Focus

- 对“待澄清”的 Personal Meaning，用户可开始澄清。
- mock Semantic LLM 根据固定 scenario 给出一到多个可编辑 Focus 建议。
- 用户可以修改 Focus statement 和 distinguishing notes。
- 提供“拆分为两个 Focus”的实际交互。拆分后的 Focus 复用同一 Personal Meaning 和 Anchors，
  并用 `splitFromMeaningFocusId` 表达来源；不要复制 Personal Meaning。
- 每个 Focus 独立接受。接受动作必须显式，生成稳定、幂等的 acceptance fact。
- 用户可以退出或暂停，Personal Meaning 可无限期保持未澄清或 Focus 未接受，不应自动推进。

### 6.4 Sense Construction

- 只有已接受的 Focus 才能开始 Sense Construction。
- 使用确定性 mock 呈现少量语义访谈 turns；actor 明确区分：`learner`、`semantic_llm`、`system`。
- 用户能够回答一个有区分力的边界问题并继续；不要把它设计成无边界的通用聊天产品。
- 支持暂停并在刷新后恢复。
- UI 可以使用“Semantic LLM（模拟）”说明当前是确定性前端 mock，不要造成真实模型调用的假象。

### 6.5 Sense Proposal

Proposal 视图必须以 learner 能理解的方式呈现以下字段：

- `coreMeaningFocus`
- 至少一个 prototype scene：summary、participant roles、states、direction/causality
- included cases
- excluded cases
- neighbor contrasts 及 distinction
- open/unresolved questions
- target-language expression candidates，每项含 type、language、surface form、rationale
- proposal version、semantic policy version 和简要 generator provenance

用户必须能选择：

- **继续澄清**：回到 Construction，之后得到新 proposal version；旧 version 变为 superseded。
- **拒绝这个提议**：proposal 变为 rejected，不创建 Sense/Alignment，允许以后重新澄清。
- **确认这个 Sense**：显示明确确认门；只有确认后才创建/复用 Sense。

不能用“保存单词”“加入学习”“开始学习”代替 Sense 确认。

### 6.6 确认 Sense Proposal

- mock confirm 命令接受稳定 `operationId`，重复提交同一操作必须返回同一结果，不能创建重复
  Sense、SenseVersion、confirmation fact 或 Alignment。
- 主 scenario 使用 `resolution = create_new`；另准备一个确定性 `reuse_existing` scenario，证明 UI
  不依赖“永远新建”。
- 成功结果必须引用精确的：`senseId`、`senseVersionId`、`senseProposalVersionId`、
  `meaningFocusRevisionId`、`senseProposalConfirmationId` 和 `personalMeaningAlignmentId`。
- 初始 SenseVersion 必须不可变，origin/review status 表达 learner confirmation，不得标成 reviewed。
- Alignment 在确认 Sense 时即创建；不要等到表达确认才创建。
- 成功 UI 显示“Sense 已确认”，并明确说明“这不表示已加入学习或已经掌握”。

### 6.7 独立 Expression Binding 页面（下一条旅程）

- Confirmed Sense 详情是 Meaning Formation 的终点与 Binding 入口；PersonalMeaningDetailScreen
  在 Sense 确认后只保留完成结果，并提供“查看已确认 Sense”，不混入 Binding 表单。
- 只有 exact `personalMeaningId + meaningFocusId` 对应的 active Alignment 才能进入独立 Binding 页面；
  缺少 required fact 时必须明确显示不可进入状态，不生成 generic binding。
- Binding 页面展示 proposal 中的 target-language candidates，允许选择、修改或暂不确认。
- 必须保留 expression type；英语 candidate 可以是 word、phrase、construction、sentence 或
  utterance strategy，不能压成无类型字符串。
- 确认时调用 gateway 的 `confirmExpressionBinding`，独立生成 expression-binding confirmation fact，并引用精确的 `senseVersionId`、
  `expressionVersionId` 和 `bindingVersionId`。
- UI 显示 relation/semantic coverage 的含义；不要默认把所有候选标为 exact translation。
- 若用户暂不确认，Sense 与 Alignment 仍然有效；详情显示“Sense 已确认 · 表达待确认”。
- 若用户确认，返回 Confirmed Sense 详情并显示“Sense 已确认 · 表达已绑定”。
- Binding 页面不是公共 content 旧详情页，也不是 Add-to-Learning 页面。

### 6.8 返回个人语义世界

- 图谱、展开卡片与清单使用同一个 world item projection；图谱只表达事实关系，不冒充旅程状态。
- 世界页并列呈现两条独立 UI-only 状态轴：
  - Sense Formation：`尚未形成 Focus`、`Focus 待确认`、`澄清中`、`Proposal 待确认`、`Sense 已确认`；
  - Expression Binding：`尚不可开始`、`待绑定`、`部分已绑定`、`已绑定`。
- “Sense 已确认但无 Binding”必须显示为 `Sense 已确认` + `待绑定`，不能显示为“待确认”或“已连接”。
- 多 Focus 聚合规则：Sense Formation 按可继续工作的 Focus 优先级为 Proposal 待确认 > 澄清中 > Focus
  待确认；只有所有 Focus 都有 active Alignment 才是 Sense 已确认；无 Focus 是尚未形成 Focus。
  Expression Binding 只统计已有 Alignment 的 Focus：无 Alignment 是尚不可开始，全部无 Binding 是待绑定，
  部分有 Binding 是部分已绑定，全部有 Binding 是已绑定；未确认 Focus 不会把 Binding 倒退或伪造为已绑定。
- 世界页与 Confirmed Sense 详情只显示每个 Binding identity 的当前 `currentBindingVersionId`，且该版本必须有对应
  confirmation；coverage 更新后的历史 BindingVersion 保留在事实中，但不重复显示为当前连接。
- 刷新页面后，所有已完成事实、稳定 ID、revisions、construction/proposal 和 alignment 能恢复。
- 不显示学习进度、复习时间、掌握度或 FSRS 状态。

## 7. 前端投影阶段

可以定义 UI-only 的 discriminated union，但名称必须清楚表明它是 **projection**，不是领域实体状态。
Personal Meaning 详情保留细粒度的旅程 phase；个人语义世界不再把它压成单一状态字段，而是
从同一批事实派生两条互不替代的状态轴：

```ts
type PersonalMeaningJourneyPhase =
  | "unclarified"
  | "focus_suggested"
  | "focus_pending_acceptance"
  | "focus_accepted"
  | "constructing"
  | "proposal_ready"
  | "sense_confirmed_expression_pending"
  | "aligned";

type SenseFormationPhase =
  | "focus_missing"
  | "focus_pending_acceptance"
  | "clarifying"
  | "proposal_pending"
  | "sense_confirmed";

type ExpressionBindingPhase =
  | "not_ready"
  | "pending"
  | "partial"
  | "bound";
```

`PersonalMeaningJourneyPhase` 只供详情旅程使用；`SenseFormationPhase` 的 `sense_confirmed` 表示
所有当前 Focus 都有 active Alignment，不关心是否已有表达；`ExpressionBindingPhase` 的 `bound`
表示所有已确认 Sense 都有至少一个真实 Binding confirmation。`aligned` 仍然是详情的细粒度 phase，
表示该 Focus 有 Alignment 且至少一个 Binding；它绝不表示 learned。

两条世界轴都必须从实体、revision 和 confirmation facts 计算。不要在 localStorage 中单独写入
任一 phase 后把它当成事实来源；graph、expanded、list 只读取同一个 world item projection。

## 8. Mock 架构和未来 API seam

建立一个小而清晰的旅程模块，推荐目录：

```text
apps/web-next/src/personalMeaningJourney/
├── types.ts
├── gateway.ts
├── gateway.ts                 # port + deterministic local adapter
├── scenarios.ts
├── projection.ts
└── usePersonalMeaningJourney.ts   # 只有确有需要时
```

页面边界对应为：`PersonalMeaningDetailScreen` 负责 PM 概览、Focus construction、Proposal 与
Sense confirmation；`ConfirmedSenseDetailScreen` 负责已确认 Sense 的只读 semantic spec 与 Binding
入口；`ExpressionBindingScreen` 负责独立 Expression Binding confirmation。三者通过
`personalMeaningId + meaningFocusId` 精确选中，应用内返回栈保持 `Binding → Confirmed Sense →
Personal Meaning / World`。

具体文件可按现有项目风格调整，但必须满足：

- React 组件依赖一个语义明确的 gateway/port interface，不直接散落读写 localStorage。
- mock gateway 可在内部复用或迁移 `personalContentService`，无需为架构纯度大改整个旧 service。
- 所有 mock 结果确定、可复现；异步方法可以模拟短暂 pending，但不得随机改变业务结果。
- 使用稳定 UUID、operation ID、revisions 和 idempotency；刷新不能重新生成已确认 identity。
- 尽量直接复用 `@sensa/contracts` 现有类型/字段；UI view model 与 domain contract 分层。
- 不添加 `fetch`、HTTP client、API route、数据库代码或真实 provider key。
- 不把 mock 存储形态声明成未来服务端 JSON 契约；未来后端契约由本次 API demand 反推。
- localStorage 解析失败或不可用时要有可见且可恢复的错误状态，不能静默伪造成功。

至少准备以下确定性 scenarios：

1. **借伞 receive direction**：从同一经历拆出“暂时取得他人物品”，候选 `borrow`。
2. **借伞 give direction**：同一经历的 sibling Focus，“暂时把物品交给他人”，候选 `lend`。
3. **相邻意义**：能展示 neighbor contrasts 与继续澄清。
4. **reuse existing**：确认后返回既有 stable Sense/SenseVersion，而不是新建。
5. **暂无合适表达**：允许 Sense 已确认但表达保持 pending。

## 9. API demand 交付物

实现过程中创建并维护：

```text
apps/web-next/journeys/personal-meaning-to-confirmed-sense-api-demand.md
```

它不是后端设计稿，而是从实际 UI 旅程反推的需求记录。至少包含：

- 每个用户意图对应的 command 名、最小输入、输出和幂等键。
- 详情与列表 projection 所需 query/read model。
- pending、empty、paused、rejected、conflict、replayed、storage/network error 等状态。
- revision/precondition 或 conflict 信息如何回到 UI。
- 哪些字段是用户输入、LLM suggestion、learner confirmation、derived projection。
- 哪些信息必须保持私密，不能进入公共 SenseVersion。
- 当前 mock 中存在但未来 API 不应照搬的本地实现细节。
- 仍未解决、需要产品/领域确认的问题；不要擅自把问题变成 canonical 事实。

不要在本任务中修改 `packages/contracts`、数据库 schema 或 API。发现缺口时先记录 demand；若缺口
使正确实现不可能，停止并报告具体冲突。

## 10. 文件所有权

本任务允许修改：

- `apps/web-next/src/**`
- `apps/web-next/index.css`
- `apps/web-next/journeys/personal-meaning-to-confirmed-sense-api-demand.md`

仅在确有必要时可修改：

- `apps/web-next/package.json`
- `apps/web-next/package-lock.json`

若新增依赖，必须先证明原有 React/TypeScript/CSS 能力不足，并在交付说明理由。优先不新增依赖。

不得修改：

- `docs/sensa/**` canonical 领域文档
- `CONTEXT.md`
- `packages/contracts/**`
- `db/**`
- `apps/api/**`
- production `apps/web/**`
- 内容生成、学习 runtime、部署和 CI/CD 文件

如果发现必须改动禁止范围，停止实现对应部分，在 handoff 中报告证据与最小建议，不要越权修改。

## 11. 交互与视觉要求

- 延续当前 `web-next` 已建立的视觉语言、侧边栏和个人语义世界 IA；不要进行全站视觉重做。
- 详情页围绕“我的意义、我的锚点、当前 Focus、Sense 边界、确认门”组织信息，不以单词卡为中心。
- 主要交互使用语义化 button/form，支持键盘、可见 focus 和合理的 ARIA label。
- pending 时禁用重复提交；错误必须就地说明并允许重试。
- destructive 行为（移除 Anchor、拒绝 Proposal）需要清楚说明影响，必要时二次确认。
- 用户之前要求代码优先推进；本任务不要求浏览器自动化或操控浏览器。可通过代码检查、构建和
  必要的本地 smoke 完成验证。

## 12. 验收场景

实现完成前，逐项验证并在 handoff 中报告：

1. 仅熟悉表达创建的 Personal Meaning 能进入详情并开始澄清。
2. 仅具体经历创建的 Personal Meaning 能进入详情并开始澄清。
3. 同时具有两种 Anchor 的 Personal Meaning 不把它们合并成单一文本字段。
4. 用户退出后，Personal Meaning 可长期保持未澄清；刷新后状态不丢失。
5. 一个经历可以拆成 receive/give 两个 Focus，二者共享 Personal Meaning/Anchors 且 identity 独立。
6. 未显式接受的 Focus 不能开始 Sense Construction。
7. Construction 可暂停、恢复，并能通过继续澄清生成 superseding proposal version。
8. 拒绝 Proposal 不创建 Sense、SenseVersion 或 Alignment。
9. 确认 Proposal 创建或复用精确 SenseVersion，并立即创建 Alignment。
10. 对同一 operation 重复确认不产生重复对象。
11. “查看已确认 Sense”进入精确的 Confirmed Sense 详情，而不是回到已结束的澄清 workspace。
12. Sense 确认后可以暂不确认表达，且 Sense/Alignment 仍保留。
13. Expression Binding 页面只对 confirmed Sense 开放，保留 expression type、relation 与 coverage；
    确认后回到详情可看到 binding，暂不绑定也能返回。
14. 图谱、展开、清单显示相同的两条状态轴；Sense 已确认但无 Binding 不会被标为待确认或已连接。
15. 修改 Anchor 保持 Personal Meaning identity，不原位改写已确认 SenseVersion。
16. 返回个人语义世界后显示正确 projection；不会显示“已学会/已掌握”。
17. 刷新后稳定 ID、revisions、facts、Proposal、SenseVersion、Alignment 和 Binding 保持一致。
18. localStorage 损坏/不可用时出现可理解错误，不把失败显示成成功。

## 13. 验证要求

从仓库根目录或明确的 `apps/web-next` 目录运行并记录结果：

```bash
cd /Users/shadow/.codex/worktrees/e546/sensa-standalone/apps/web-next
npm run typecheck
npm run build
```

本包当前没有独立 `lint` script，因此不要声称执行了不存在的命令。对本任务改动做针对性静态检查，
并运行：

```bash
cd /Users/shadow/.codex/worktrees/e546/sensa-standalone
git diff --check
```

如现有结构适合，增加一个小型、确定性的 journey smoke（优先纯 TypeScript、无新测试框架），覆盖：

- projection 从事实推导；
- reject 不创建 Sense；
- confirm command 幂等；
- Sense confirmation 与 Expression Binding confirmation 分离；
- reload 后 identity 不变。

不要为本任务引入 blanket unit-test suite。不要调用付费 LLM、TTS 或外部服务。

## 14. 完成后的 handoff 格式

完成后只给出事实性报告，包含：

1. 实现了哪些用户可见步骤。
2. 修改/新增的文件清单及各自职责。
3. mock gateway 的 command/query seam。
4. API demand 文档中确认的需求与仍待确认问题。
5. 所有验证命令及结果。
6. 已知限制或无法完成的点。
7. 明确确认没有实现或触发 Add-to-Learning、Evidence、FSRS 或后端工作。

不要提交代码。完成后等待 Codex 审核与微调。
