# 原生策略分配、准备状态与首次运行固定

日期：2026-09-08。属于 LF-1b 的本地学习纵切，不代表整个原生产品或所有学习模式已经迁移。

## 用例与规则

Flutter 首页可设置默认学习方式，已入学项目可设置所属学习包的方式、单项覆盖或恢复继承。
优先级按领域模型执行：单项明确分配 → 已选学习包来源 → 学习者默认 → 系统默认。
首次开始前可以重新选择；开始时将完整 Profile 版本、来源分配版本、三个 purpose 的绑定与计划固定。
此后修改默认或学习包设置，只影响未固定项目。已固定单项拒绝普通修改，暂停/重启和后续复习、再学习继续使用固定计划。

尚不支持的高保证、交错四阶段方式可保留选择，但展示阻塞原因并禁止开始；不会静默改成轻量模式。
本轮只有既有轻量文本 consumer 可执行。正式多阶段界面与执行器仍需迁移。

## 来源与边界

直接对照 `apps/web/src/experience/learningRuntime/policyProfiles.ts`、`contentCapabilities.ts`
以及 `learningJourney/journeyState.ts`。能力合取保留最差状态、同级首项、声明顺序和 provisioning/Materialization 一致性规则。
Profile manifest 保留 Web 三套版本及声明，并用源对照校验防止漂移。
四级分配与版本化固定按 `learning-connection-model.md` 实现；Web 原型的简化来源状态不是完整四级权威实现。
正式 Run 还要求 ready 且已具备材料，不能把 preparing 当作可运行；这是领域门槛，不宣称与旧原型宽松运行门槛一致。

原生既有 `lightweight/v1` 使用 consumer 三 purpose 与 FSRS，继续原样保留。
Web `lightweight-profile-v2` 的 fixed-ladder 生命周期不能覆盖原生历史；其声明仅作为对照，不替换历史版本。
Rust 计划核心采用独立数据接口；SQLite 和 Flutter 不直接计算推进或调度结果。

## 存储与恢复

SQLite v4 添加分配修订、来源关联、不可变计划修订、首次 Run commitment 和 initial/retention Run 计划引用。
所有变更经过既有 CAS / operation ledger；首次 Run 与 commitment 在同一事务提交，失败同时回滚。
学习包来源按包 ID/版本记录，入学时选定首个可用来源；后来导入同一材料的其他包不自动切换该选择。
这不是完整 Curriculum enrollment/range 或多来源选择界面。

v1–v3 原生库在打开时事务升级：保留原策略引用为显式分配，补建计划及既有 Run 的固定元数据，
用 `legacy_run_v3` 标明来源。原始尝试、完成、Outcome、调度、Run 和库修订不改写。
这是旧原生 schema 的升级，不是 Web/API 用户资料导入，也没有迁移 owner 数据或双写历史。

## 验证

- `sensaNativePlanningParity.mts`：直接调用原 TS，651 个能力合取/Profile 计划精确对照；manifest 与实际 TS 注册表全量一致。
- `policy_lifecycle.rs`：四级覆盖/清除继承、计划修订、阻塞拒绝、Run 插入故障回滚、操作重放、固定后拒绝修改、后续复习引用、重复来源保护和 v3 升级；另验证 ready 不替代实际材料/运行能力、未知版本拒绝且不改变状态。
- 既有 v1/v2 升级测试继续比较全部旧学习事实；新增元数据单独断言，避免把新生成身份误当成旧事实变化。
- Flutter `policy_test.dart`：选择不支持方式后阻塞、明确改为轻量、首次运行固定、暂停时改默认、独立进程重开后继续原 Run 并完成。

平台验收：macOS 使用 `policy-mac-0908a`，Android API 36 使用 `policy-android-0908a`，
两端首次流程与独立进程 recovery 均通过（各 +1）。Android 两次均 `--no-uninstall`，飞行模式设置为 1。
另在 macOS 使用既有 retention fixture 验证旧库升级、到期复习与再学习恢复。

根级 typecheck/build/lint、Rust workspace 回归、Clippy `-D warnings`、原生桥 `cargo check --locked` 通过。
完整核心 smoke 包含既有 7,297 个调度/结算对照、1,490 个 Progression/组合对照及本轮 651 个计划对照。
Flutter analyze 无问题；macOS release 构建通过（54.4 MB）。保留已有 SPM / objective_c framework 命名警告，不据此宣称其他平台或性能已验收。
本轮全部使用隔离合成库，无付费模型/TTS 调用，未推送或部署。

## 下一项

将通用 Observation / Decision / Checkpoint 状态接入 SQLite 事务与恢复，再接对应多阶段 Flutter 消费链路。
Policy Migration、完整角色资源/媒体、scope 准入、正式 Activity/Mixed/汇总均保留在迁移清单中。
