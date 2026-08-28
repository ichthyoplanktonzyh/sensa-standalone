# 前端重写工作笔记

> 临时工作文件，不属于 `docs/sensa/` 领域模型层。重写完成后删除。
> 记录日期：2026-08-26

## 一、决策（已确认）

- **范围**：前端全部重写（UI + 状态编排 + store/sync/api 传输层）。
- **内容加载**：按需加载，不再冷启动全量拉取。
- **后端**：可以改。
- **技术栈**：保持 React（`AGENTS.md` 明确要求 Web remains React）。
- **视觉基线**：`docs/reference/sensa-v1/product-prototype.html`（PRD 认可的 V1 交互原型）。

## 二、原型能抄什么、不能抄什么

原型是 1223 行单文件（含 474 行 CSS），9 个 surface：
`home / books / content / learning / profile / study / example / sense / finish`
study 内含 5 个 stage：`experience → reveal → boundary → repair → cloze`

**可以逐像素照搬**：视觉、文案、信息层级、交互手势、状态转换的观感。

**不能照搬**：原型的 study 五段流程是**前端状态机**推进的，用 `PACKAGES` 常量假数据。
真实系统里下一步做什么由**服务端 Semantic Policy** 决定，前端只能：

1. 拿服务端返回的 `action.kind` 去选对应 renderer；
2. 只渲染 `action.assets` 显式引用、且 role 匹配的资产。

依据：`runtime-rule-packet-v1.md` §2、`product-requirements-v1.md` §4.5（动作资产封闭）。
这是当前实现和原型偏离的地方里，**唯一一处当前实现是对的**。

## 三、已修复的后端 bug（保留，勿回滚）

全部经真实 HTTP + sync 双通道验证：6 个 Encounter 跑通
introduction / review 成功 / review 失败三条路径，Action 数量与
`runtime-rule-packet-v1.md` §5 完全一致。

### 1. Action digest 算法分裂 —— 曾导致所有学习内容无法渲染

服务端和 kernel 各写了一套 digest 计算，canonical JSON 的 key 名不同：

| 位置 | key |
|---|---|
| `encounter/postgres.ts` 原 `actionOrderDigest` | `assetReferences` |
| kernel `canonicalLearningActionDigest`（前端用） | `assets` |

canonical JSON 对 key 敏感 → 两边 digest 必然不同 → 前端 `resolveActionView`
恒定返回 `action_digest_mismatch` → 学习内容全部 fail-closed。
同一 bug 也让 `sync/postgres.ts:1375` 的校验必然失败。

**改法**：Action 身份 digest 统一用 kernel 的 `canonicalLearningActionDigest`（单一事实源）；
boundary 选项顺序不是身份 digest，拆为独立的 `boundaryChoiceOrderDigest` 保留原算法。

文件：`apps/api/src/sensa/encounter/postgres.ts`

### 2. `interrupt` 路由返回 500 但副作用已生效

`sensaEncounterStepSchema` 只有 `next_action | completed` 两个变体，
而 `EncounterModule.interrupt()` 返回 `kind: "interrupted"`。
事务已提交，序列化响应时才失败 → 客户端误判失败并重试。

**改法**：新增 `sensaInterruptedEncounterSchema`，interrupt 路由改用它。

文件：`packages/contracts/src/sensa/schemas.ts`、`apps/api/src/routes/sensaEncounter.ts`

### 3. `buildNextAction` 在已终结的事实上继续造 Action

原来 introduction 分支只要没有 pending action 就**无条件再造一个 `grounding_bind`**。
违反 rule packet §5（一次有效 acknowledgement 应完成 Encounter）和
`learning-runtime-model.md` §3（resume 只能返回未解决的当前 Action）。
连带后果：sync 下 `learning_attempt.record` 返回 `nextAction != null`
→ 前端 `shouldQueueTerminalCompletion` 不排队 complete → Encounter 永久卡在 `active`。

**改法**：Stop Policy 是"既有事实的性质"，不是"某个接缝的性质"。
抽出 `acceptedOutcome()` 供 `completeEncounterInExecutor` 和 `buildNextAction` 共用；
`buildNextAction` 在所有 Action 都已解决时先问一次 Stop Policy，
满足就完成 Encounter，而不是再发一个 Action。
这同时修掉 review 分支上同类的重放场景。

### 4. completed 响应永远序列化失败（500）

`sensaEncounterStepSchema` 的 completed 变体要求 ISO 字符串时间戳和
`formMapping` 驼峰键，而 Encounter Module 返回的是 kernel 领域对象：
`Date` 实例 + 5D 投影（`form_mapping` 蛇形键，因为 `stateDigest` 就是按这个形状算的）。
**结果是任何 Encounter 完成都会在事务提交之后炸 500** —— FSRS 已经写了、
Encounter 已经关了，客户端却收到失败。

**改法**：路由层加 `encounterStepResponse()` 做 Date → ISO 的传输编码；
schema 的 completed 变体改成如实描述 kernel 的 5D 投影
（新增 `encounterSemanticProjection`，**不要**把 `form_mapping` 改名，会破坏 digest 复现）。
Sync 通道不受影响，它本来就是从 DB 行重新读的 wire 形状。

文件：`packages/contracts/src/sensa/schemas.ts`、`apps/api/src/routes/sensaEncounter.ts`

### 5. 完成事实（completion fact）按客户端时钟排序

`latestValidAttempt` 原来按 `occurred_at` 排序、UUID 字典序兜底。
`occurred_at` 是**客户端给的**：同一毫秒内的两次 Attempt，或离线副本时钟偏移，
会让"最后一次有效 Attempt"随机落到 boundary Attempt 上 →
Stop Policy 重放失败 → 409 `kernel_replay_failed`，学习流程直接断在这。
实测复现过。

**改法**：改按 Encounter 自身的因果序排（Action ordinal → Attempt ordinal），
完全由服务端拥有，与时钟无关。FSRS 仍然用 `occurred_at` 作为
"最后一次带证据的 Attempt 时间"（§9 要求）。

### 6. 两处 `forUpdate` 参数是死的

`loadActionContexts` / `loadAttempts` 里的 `${forUpdate ? "" : ""}` 恒为空串 ——
声称加行锁，实际从未加过。所有写路径都先经 `lockEncounterSense` 拿到
per-Sense advisory lock，串行化本来就成立，所以删掉参数而不是补锁。
（`loadSemanticState` 的 `FOR UPDATE` 是真的，保留。）

## 四、按需加载的接口（已就绪）

### 1. 轻量索引：用现成的 manifest 接口，不需要新写

`GET /workspaces/:ws/sensa/study-plans/:planId/content/manifest`

实测：438 个 member、**206KB、~450ms**，字段正是需要的
`ordinal / senseId / senseVersionId / lemma / partOfSpeech / guideLabelL1 /
teachingPriority / packageDigest`，不含 assets、examples、audio。
一次拉完即可，够词书列表、我的内容、搜索用。

### 2. 单个 Sense 的完整 package：新增

`GET /workspaces/:ws/sensa/study-plans/:planId/content/items/:senseId`

实测：**29KB、~90ms**（对比整页 25 条 = 681KB）。
返回体与 `content/items` 里同一条目**逐字节一致**，前端可以共用一个 parser。
非成员 Sense → 404（与"计划不存在"同一响应，不做存在性预言机）；
非 UUID → 400。

文件：`packages/contracts/src/sensa/{catalog,schemas}.ts`、
`apps/api/src/sensa/catalog/pinnedContent.ts`、`apps/api/src/routes/sensaPinnedContent.ts`

### 注意：改 contracts / kernel 必须重新 build

`@sensa/contracts` 的 exports 指向 `dist/`，API 的 `--watch` 只看 `apps/api/src`。
改完 `packages/**` 要跑：

```
npm run build -w @sensa/learning-kernel && npm run build -w @sensa/contracts
```

否则改动看起来"没生效"。

## 五、前端重写（已完成，`apps/web/src`）

旧的 5508 行已全部删除重写。新结构（5600 行，其中 CSS 787 行）：

```
main.tsx  App.tsx  env.ts
api.ts         传输层：唯一的 schema 校验点
store.ts       IndexedDB 本地投影 + outbox + 内容缓存
sync.ts        Sync v2 编排（bootstrap / push / queueCompletions / pull）
content.ts     按需内容库（manifest 常驻 + 单 Sense package 懒取）
session.ts     Encounter 编排（plan-next → open → attempt → complete）
derive.ts      纯派生（今日计数、连续天数、outbox 健康度）
useSensaApp.ts 单一状态控制器
ui/            9 个 surface + 4 个 Action renderer + audio/assets/primitives
styles/        tokens / shell / home / utility / study / example
```

**保留未动**（`scripts/sensaRuntimeSmoke.ts` 依赖，且逻辑本来就是对的）：
`features/study/resolveActionView.ts`、`features/study/lifecycle.ts`、
`features/mastery/declaredMastery.ts`、`store.ts` 的 `SensaLocalSnapshot` 类型。
`npm run sensa:runtime-smoke` 通过。

### 关键设计决定

1. **校验只发生一次，在网络边界**（`api.ts`）。IndexedDB 里的投影读取时**不再校验**，
   改用 `projectionEpoch` 常量钉合同：形状变了就整体丢弃重新 bootstrap。
   例外只有两个：outbox（未同步的学习意图，必须能作为可恢复记录活下来）和
   `meta.currentAction`（畸形 Action 绝不能进 renderer）。
   —— 这就是冷启动卡死的根治。

2. **内容按需**。manifest（438 成员 / 206KB）冷启动拉一次，撑起词书/内容/搜索；
   package（29KB）只在某个 Sense 真要被教或被打开时才取，带 LRU 上限 320 条。
   缓存有效性用 `packageDigest` 对比 manifest 成员摘要，重新 pin 的词书精确失效。

3. **流程完全服务端驱动**。前端只做两件事：按 `action.kind` 选 renderer；
   只渲染 `action.assets` 显式引用、role 匹配的资产。
   不判定对错、不决定 Encounter 何时结束、不自己补发 Action。
   对错来自已接受事实（`latestAttemptVerdict` 读 attempt fact 的 `isCorrect`），
   停留 1.5s 展示后再进下一屏。

4. **失败可诊断**。`resolveActionView` 的 `reason` 不再被丢弃，
   在 study 界面以 `<code>` 显示；HTTP 错误带 requestId 进 toast。

5. **拒绝假功能**。原型的"收藏"没有 Bookmark contract，不做；
   浏览 Sense 详情不发媒体授权（媒体 URL 只对 Action 签发），
   所以详情页不放播放按钮，直接写明原因。

### 冷启动实测（干净 origin）

4 个请求，首页可用 ~700ms：`/me` 12ms → `sync/bootstrap` 23ms →
`sync/pull` 13ms → `content/manifest` 421ms。
旧版是 20 页 × 25 个 package 全量拉 + 几万次 Zod 深校验。

### 已验证 / 未验证

已跑通（真实数据）：首页计数、词书 438 条 + 搜索、意思详情（触发按需取包）、
例句卡（目标词高亮、上下文、辨义线索）、我的内容、我的学习 + 偏好、账号与数据、
返回栈、IndexedDB 卡死时的降级（超时 → 可重试的错误页）。

**未验证：学习流程本身。** `POST .../sense-encounters/:id/open` 当前返回 500
（后端正在改 semantic policy，见下）。前端在这条路径上的表现是正确的：
捕获、toast 显示服务端消息 + requestId、退回首页。

## 六、当前阻塞（后端，非本次前端范围）

2026-08-26 16:46 起，后端在 kernel 加入 `SensaSemanticPolicyDecisionCode`，
`LearningAction` 增加必填字段 `semanticPolicyDecisionCode`，并改动
`apps/api/src/sensa/encounter/postgres.ts`、`sync/postgres.ts`、
`routes/sensaEncounter.ts` 与 contracts。

期间出现过 `packages/contracts/dist` 落后于 kernel 的窗口（前端 typecheck 报
`Property 'semanticPolicyDecisionCode' is missing`），重新 build 后已消失。
`/open` 的 500 仍在。前端不需要为此改动 —— 它只透传 kernel 解析出来的 Action。

## 七、优化候选（重写过程中观察到，尚未处理）

按"是否影响正确性"排序，不是按工作量。

### A. 预取策略是错的（真 bug，只是不致命）

`useSensaApp.ts` 的 `advance()` 在拿到下一个 Action 后，预取
`members[at + 1]`（manifest 里的**下一个 ordinal**）。但 `plan-next` 挑的是
新学**或到期复习**，复习的 Sense 和当前这个在 ordinal 上毫无关系。
所以复习场景下这次预取 100% 是浪费一次 29KB 请求，而真正要用的包仍然现取。

正确做法：从 `snapshot.memoryStates` 里按 `dueAt` 排序取最近到期的那个，
以及"今日还没学的第一个未开始成员"，预取这两个。

### B. `synchronize()` 里还有 3 次 `loadSnapshot()`

`sync.ts` 的 `drain()`：push 后一次、pull 前一次、结尾一次。
比旧版的每轮 4 次好，但仍可以让 `applyPushResult` / `applyPull` 直接返回新快照，
省掉两次全量读。目前每次读是 9 个 object store 的 `getAll()`，
encounters/appendFacts 会随使用无限增长 —— 这是**将来**会变慢的地方。
`appendFacts` 尤其：它只增不减，没有任何裁剪。

### C. 派生函数没有 memo

`HomeScreen` / `StudyScreen` / `FinishScreen` 每次 render 都重算
`todayCounts()`（遍历 encounters + memoryStates）和 `masteredSenseIds()`。
数据量小的时候无所谓，但 `masteredSenseIds` 内部对每个 pending 意图调
`effectiveMastery`，后者又整表扫 outbox，是 O(n²)。

### D. 视觉/交互

- 例句卡 `.example-detail` 中间有一大块空白：`.translation-toggle` 从原型继承了
  `margin: auto 0`，在多出"辨义线索/常见搭配"两行后就撑得很怪。
- verdict 的 1.5s 固定停留是拍脑袋定的，没有依据。答对和答错应该不一样长。
- `busy-veil` 罩住整个 frame，非学习界面上一次同步就锁全屏，过重。
- 词书 438 行用"显示更多 40 条"分页，没有虚拟滚动。现在够用，1000+ Lexeme 时要看。

### E. 没做的功能（有意为之，不是遗漏）

- **收藏**：原型有，但没有 Bookmark contract / schema / sync 操作，不做假的。
- **选择/更换词书**：`GET /sensa/books` 当前返回空（见第八节数据状态），无法测试。
- **`semanticPolicyDecisionCode`**：后端刚加的字段，是"语义策略为什么选这个 Action"
  的诊断码。适合放进 study 的诊断面板，但要等后端合同稳定。

## 八、本地环境

- Postgres 18.4 跑在 Docker 容器 `docker-postgres-1`，端口 5432。
- 数据库 `sensa_standalone_dev`：249 Lexeme / 724 Sense / 438 Book 成员 /
  1 个 active Study Plan / 1563 audio assets。
- `apps/api/.env`、`apps/web/.env` 已建好（gitignored）。
- 启动：`npm run api:dev`（:8080）、`npm run web:dev`（:3000），入口 `/sensa`。

### 取舍：数据库用的是 owner 角色

`DATABASE_URL` 用 `flashcards_owner`，它有 `BYPASSRLS`。
设计上应该用 `backend_app`（RLS 生效），但其密码未知。
**后果：RLS 相关问题在本地测不出来**，跨 learner 越权访问这类 bug 会被掩盖。
要跑真实 RLS，给 `backend_app` 设本地密码后替换 `DATABASE_URL`。

### 数据状态

Book version 是 `retired`、content release 是 `superseded`，
所以 `GET /sensa/books` 返回空。按 rule packet §4 这是**预期行为**
（已 pin 的仍可运行，但不再公开可发现），不是 bug；
但"选择/更换词书"这条路径因此无法测试。

Encounter 现状：4 completed + 3 cancelled，全部终态，下次 plan-next 会开干净的新 Encounter。
历史 8 条 learning_actions 全是 `sensa-learning-action-v1`（代码已升 v2），
它们属于已终结的 Encounter，不影响新流程，但会在前端日志里报 digest 不匹配。
