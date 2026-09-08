# 原生通用进度内核与策略组合迁移

2026-09-08。主代理直接实现，无委派。Owner 已确认完整承接既有 TS/Web 能力，本轮完成
Protocol-local Progression Kernel、正交策略 Registry 和纯组合引用校验，并接入原生库入口。
本轮没有增加新的 Flutter 学习模式，也没有把通用 Observation/Checkpoint 历史写入 SQLite。

## 来源与接口

直接核对并迁移 Sensa 自有代码：

- `packages/learning-kernel/src/runtime/protocolProgression.ts` → `crates/sensa-core/src/progression.rs`。
- `apps/web/src/experience/learningRuntime/protocolPolicies.ts` → `crates/sensa-core/src/policies.rs` 的 Registry、原有策略 inventory。
- `apps/web/src/experience/learningRuntime/runtimeComposition.ts` → 同模块 `validate_composition`。

领域依据为 CONTEXT、learning-connection-model / learning-runtime-model 中的 Protocol Run、
Checkpoint、Observation/Decision、Progress Reset 和策略组合边界。现有消费级 phase/settlement/FSRS
仍有独立职责；Checkpoint credit 不成为 scheduler 输入，也不自动成为独立 Evidence 或掌握声明。

`create_state` 接收固定 Protocol Definition；`decide_and_apply` 接收注册策略、State、Observation
和 decision identity，返回 immutable Decision 与下一 State；`apply_decision` 校验并原子应用已给定
Decision。失败不修改输入；同 ID/同内容 replay 返回 applied=false，同 ID/异内容报错。
这些是 Rust 领域接口，Flutter bridge 没有暴露任意 effects/credit 写入入口。

`ProgressionPolicy: Send + Sync` 是开放的行为接口。Registry 接收调用方提供的 trait object，按 ID
查找行为；新增 Profile/策略无需修改核心中的名称分支。原有 completion-only、current-checkpoint-reset、
run-reset 策略及 5 个正交注册轴保留；Evaluation/Repair/Memory Outcome 轴在原 TS 注册表中只声明 ID，
本轮同样没有把它们伪装成已经迁移完成的 evaluator/repair 执行器。

## 保留的语义

- Checkpoint 身份独立于 capability、界面与调度身份。
- credit / invalidate / schedule repair / require reassessment / current、declared-set、run reset / advance / complete 全部保留。
- Repair 完成只清理失败并要求独立 reassessment，不授予 credit。
- Run reset 增加 progress epoch；checkpoint reset 保留其他 checkpoint；重置不会删除旧 Decision receipts。
- 完成资格检查 required Checkpoints、可选 same-epoch 要求、pending repair 和 reassessment。
- 已完成 State 不能继续接受普通 Observation；未外部提交前的失败纠正沿用原 TS 特例。
  这不授予修改已持久化 Completion/调度历史的权限。
- Decision canonical fingerprint 连同顺序比较。固定 schema 字段按键排序；reassessment 身份使用
  JS UTF-16 排序语义，非空检查沿用 ECMAScript trim（包含 BOM）。
- Rust 输入使用带类型的枚举与非负整数；Run reset 额外拒绝超过 JS safe integer 的 epoch，避免跨语言精度丢失。

组合校验保留：非空组件、fallback 引用、三 purpose 的 5 个策略轴、重复 Checkpoint、
无 Checkpoint 的不合法 completion、adapter/orchestration、首学 completion contract、renderer、
content capability、store/surface 及 retention scope 的能力引用。这里只迁移 runtimeComposition 的引用校验；
各专用 Registry 的附加语义（如 independent scope 准入、编排声明一致性）仍由对应后续迁移负责。

## 原生接入

`crates/sensa-library/src/composition.rs` 声明当前真实可执行的轻量文本 consumer、SQLite store、
Flutter surface、Recall/Reveal 和三 purpose 的策略绑定。每个进程在打开本地库前通过 OnceLock 校验组合；
悬空引用失败时不打开/写入数据库，不静默选择其他模式。

原生只注册当前已支持的子集。核心保留完整旧 inventory 不代表原生已实现结构化/四阶段 renderer。
当前 Graph 是组合校验消费的可移植描述，平台的 surfaceFor 方法投影成固定 purpose map；
不将 TS 回调序列化为数据，不以这些描述替代实际 Adapter 执行和 Policy commitment。
本轮无需 SQLite schema 迁移、数据回填或旧历史重写；原生 Cargo.lock 增加 core 对 serde_json 的运行时依赖。

## 验收

- `scripts/sensaNativeProgressionParity.mts` 调用原 TS Progression/Policy；从源文件提取并转译原纯组合 validator，
  排除浏览器 singleton root。比较完整 JSON State、Decision、fingerprint、结果和错误文本，**1,490 个精确对照通过**。
- 输入还包含真实 Web 三套 Profile、Adapter、Orchestration、Surface/Store/Scope 注册表。
  renderer/provider ID 从实际静态注册源投影并固定数量断言；不据此声称 React renderer 已迁移或执行。
- `crates/sensa-library/tests/composition.rs`：核心未知的新 trait 策略可组合并完成两个 Checkpoint；
  State 序列化恢复及 replay；五轴重复身份、空白身份、悬空 renderer 和未启用原生策略拒绝。
- `sensa:native-core-smoke` 已纳入新差分脚本，继续运行原 7,297 个 scheduling/settlement 对照与 SQLite 回归。
- 原 TS progression smoke、Rust workspace tests、Clippy -D warnings 和原生桥 cargo check 通过。

平台回归：

| 环境 | 首次流程与独立恢复 | 结果 |
| --- | --- | --- |
| macOS | `macos-progression-20260908-a`，既有 retention_test 首次及 recovery | 两次均 +1，exit 0 |
| Android API 36 / emulator-5554，飞行模式=1 | `android-progression-20260908-a`，两次均 --no-uninstall | 两次均 +1，exit 0 |

复用上一轮真实 Flutter → Rust → SQLite 测试，验证组合入口没有破坏原有等待、提前、同 Run 恢复和结算边界。
仅使用隔离的合成库；Android 验收后停止模拟器、保留测试数据。未调用模型/TTS，没有迁移 owner 数据。
根级 `npm run typecheck`、`npm run build`、`npm run lint` 已通过；无 Web/插件功能改动。
Flutter analyze 无问题；`flutter build macos --release` 成功（53.5 MB）。
保留已有 SPM / objective_c framework 命名警告，不据此宣称新增平台或性能验收。

## 后续范围

下一条应把 Policy Assignment / purpose plan、readiness 与首次 Run commitment 迁到本地，
再将通用 Observation/Decision/Checkpoint 状态接入有版本的 SQLite 事务与对应 Flutter 学习模式。
现有原生轻量首学/复习继续走已验收的消费级账本；纯函数序列化测试不是通用持久化已经交付的证据。
正式 Activity/Mixed/汇总、完整材料与媒体、Profile 生命周期、独立 scope 准入及编排/renderer 执行仍在迁移清单中。
