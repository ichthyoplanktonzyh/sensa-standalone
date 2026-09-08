# 四阶段学习编排内核迁移

日期：2026-09-08。LF-1b 增量，迁移对象是已有 Web 四阶段队列及复习/再学习编排。

后续 Owner 指示：四阶段只是验证内核可扩展性的原型，其正式 UI 尚未完整确认。
本记录的代码/测试作为扩展性证据保留；文末材料与 Flutter 施工计划暂停，不再是当前迁移前置。
当前优先 [高保证学习](native-assurance-orchestration-handoff.md)。

## 本轮实现

`crates/sensa-core/src/four_stage.rs` 直接对照
`apps/web/src/experience/learningRuntime/interleavedFourStageProtocol.ts` 实现：

- 保留看词选义、语境回想、听音选义、终关回想四个 Checkpoint 及版本化完成条件。
- 接收 Planner 已选定的目标集合，按 Checkpoint、上次轮次、原始目标顺序稳定选取；
  保留 minGap 和候选不足时的回退，不把数量偏好移到 Protocol。
- 任一失败按 run-reset-v1 开启新 epoch；修复反馈只要求重新评价，不直接补发 credit。
- assessment 期间重复 next 不推进；feedback 未完成不能跳到下一项；重复 settle 不重复计数。
- 复习 known/vague/forgotten 保留 good/hard/again 自报映射；忘记后进入 relearning，
  后续再学习不会产生原 due Review 的第二份 Outcome。

复用已迁移的 Progression Kernel；本轮不修改 FSRS 或已有轻量完成语义。
Rust 接口的 minGap 是调用方已归一化的非负整数；差分使用 0/1/2/5，示例适配器缺省为 2。
初始 Run ID 由宿主提供，避免迁入 Web 的随机/时钟副作用。URI 组件编码保留 Unicode 目标身份。

## 恢复格式

两个队列都有 v1 序列化状态，包含固定初始集合、已评价结果事件、当前 assessment/feedback、
进度和计数。`restore` 用固定 v1 编排重放已保存的评价结果，并与完整快照比较；
它不重新对学习者响应评分。未知版本及状态/事件不一致时拒绝恢复。

该格式目前属于核心消费接口，**尚未成为原生 SQLite 的正式多阶段 Run 存储格式**。
未来应用接入需要将真实 Attempt/Observation/Evidence 与现有通用账本放在同一事务中，
不能让队列快照成为第二份学习权威。本轮未更改 SQLite schema 或历史数据。

源码原型在通过 Checkpoint 时构造 symbolic evidence ID；为差分保留此核心描述，
不将这些字符串当作已有正式 Evidence。真实评价及 Evidence Rule 尚需通过内容/Action 适配接入。
ReviewQueue 返回的 Outcome 也是编排结果描述，不直接写 Memory 或调度。

## 验收

`scripts/sensaNativeFourStageParity.mts` 直接执行原 TS 队列，与 Rust 完整中间投影和错误行为比较：

- 213 条操作序列、9,609 个精确状态/错误对照。
- 空集合、单目标、穿插与间隔不足、Unicode 身份、重复身份、错误跳转、重复操作、失败和修复。
- 156 份快照由第二个独立 Rust 进程恢复一致；每次操作内部也验证序列化恢复，包括待反馈状态。
- 24 份未知版本或计数/状态与事件不一致的快照被拒绝。

已纳入 `sensa:native-core-smoke`，继续保留既有规则差分与 SQLite 事务回归；本轮全部通过。
`cargo clippy --workspace --all-targets --locked -- -D warnings`、原生桥 `cargo check --locked`、
根级 `npm run typecheck`、`npm run build`、`npm run lint` 均通过。没有付费模型/TTS、数据迁移、推送或部署。
本轮是核心/独立进程验证，没有把它记为 Flutter 四阶段界面或听音能力的平台验收。

## 为什么还没有开放 Flutter 四阶段入口

已核对 `policyProfiles.ts` 和正式 Web 的 `InterleavedFourStageRuntimeScreen.tsx`：
四阶段声明需要 `structured_learning_package`。当前原生导入器 `sensa-local-text-pack-v1`
只有轻量文本材料，没有完整选择题/干扰项、修复资源、听音资源和对应材料版本绑定。
不能把文本包标记为满足该能力，也不能用简单自报按钮替代正式的四种呈现。

因此保留已确认的 blocked 行为。下一条先迁移该模式所需的结构化材料、Action 与评价绑定，
再将本轮编排接入正式本地事务和 Flutter 四种呈现，并完成平台离线/暂停恢复验收。
高保证、Activity/Mixed 和其他清单内容仍继续保留。
