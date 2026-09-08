# 原生高保证学习纵切与 Profile 执行连接

2026-09-09。本轮承接 `0d0fb240` 的纯队列迁移，完成已确认高保证学习路径的本地产品接入。
这不是全部 TS 成果迁移完成，也不宣布 LF-1b 或 M3 完成。四阶段正式材料/UI 继续暂停。

## 用户现在能完成的流程

导入已发布 runtime release 和媒体 → 显式加入学习并选择高保证方式 → 场景/讲解 →
识别、主动回想、迁移和条件边界检验 → 毕业与首次调度 → 到期回答 → 失败后的包内定向修复及独立重测。
Flutter 呈现场景、首字母/选择辅助、固定选项反馈、例句/用法、英美发音、本地音频、暂停、撤销和恢复。
已掌握声明不生成毕业或排程，可以从本轮摘要重新加入。声明后的摘要可以再次打开。

- Context/Sense/Expression 及正式 Learning Target 身份不变；本轮没有增加 Focus 必填条件。
- 本地学习、媒体与恢复不需要 Hono、账号或模型调用。文件选择使用原生系统入口。
- 导入只入库，入学必须显式执行。当前正式发布物准入语言是 en / zh-CN。
- `sensa-runtime-artifact-v1` 封装现有 runtime release 与 base64 媒体，总输入上限 20 MB。
  媒体逐项验证 SHA256；版本冲突、无效任务/引用或媒体失败原子回滚。单独 release 可入库，但缺失媒体时不伪称可执行。

## 实现与权威边界

`assurance_material.rs` 依据现有 Web `assessmentResources.ts`、`AssuranceCard.tsx` 和
`learningCatalog.ts` 实现固定任务投影、原始答案评价与包内修复资源选择。
`runtime_release.rs` 对照正式 TS validator 和导出的 Zod schema 做离线准入；不会通过读取远程 schema 放宽校验。

SQLite v6 保存 release/材料化 digest、媒体、会话、原始 intent、草稿/辅助状态与独立 Evidence。
首学继续使用通用 Progression Kernel 的 Observation/Decision/Checkpoint 状态；它们作为可重放队列历史持久化，
高保证没有冒用轻量 `protocol_journals` 表。事件最后结果与当前会话必须一致，队列恢复另外校验语义重放。
Evidence 使用独立 operation/attempt 身份，撤销重答不会覆盖旧证据；毕业还要查验真实的独立通过记录。

三个 purpose 共享现有 Target、Policy commitment、operation/CAS、Memory 与 FSRS 权威。
会话、证据、毕业/Review Outcome、Need 和排程在同一个 SQLite 事务中提交。
到期 Review 的首次结算不可被撤销重答改变；重学完成不再次评分该 Review。跨已结算毕业的撤销被拒绝。

首次排程采用已迁移的生产 FSRS6 模块，**没有移植旧 Web 原型为 QA 压缩成立即到期的演示时钟**。
队列/判题/材料的源差分与生产调度差分分别验收，不能据此声称原型演示日期完全相同。
运行时不接受 UI 提交 correct、Evidence、毕业或 schedule。

## Profile 到执行器的验收

实际路径是 Assignment → 固定 purpose plan → supported binding resolver → queue/evaluator/repair/settlement。
入口校验 protocol/version、orchestration、evaluation、progression、completion、repair、memory outcome、
checkpoint/content 以及生命周期 scheduling/evidence 绑定。未知组合拒绝执行，不按 Profile 名称猜测行为。

首学把每个目标固定计划中的 progression ID 注入队列，实际调用 Registry 的策略实现。
验收用同一材料、同一事件序列证明：当前关卡重置保留此前识别 credit；整轮重置会撤销此前 credit；
保存恢复后差异仍保持。运行后禁止替换策略。重命名 Profile 不改变可执行性；不支持的评价组合被拒绝。
本地多目标回归还在开始后修改 learner 默认方式，验证已固定的高保证 Run 与会话没有被改写。
这不意味着任意未来策略已经可用；新策略仍须有实际执行器和验收，Policy Migration 仍未实现。

## 验证证据

- 固定任务：90 个实际 Web 投影；624 个实际 Web submit/Rust 判题对照；4 个无效绑定拒绝。
- 包内修复：14 个实际 Web 修复资源绑定对照；错误资源键拒绝。
- 发布物：262 个 TS/Rust schema 与语义错误码集合一致。
- 原有回归保持：FSRS/协议 7297、通用进度 1490、计划 651、四阶段 9609 状态、
  高保证 selector 2170、首学队列 774 状态、复习队列 820 状态/effect。
- SQLite：四目标完整首学，每条命令重开库；失败 Review → 撤销改答 → 修复重测，排程只写一次；
  声明/重新加入、版本冲突、媒体失败、幂等、非法命令回滚、会话破坏拒绝、普通配置不改已有 Run。
- macOS：`mac-high-02` 首学及独立进程恢复；`mac-high-review-01` 失败/修复/重测；
  `mac-high-final` 最终界面包含辅助回想后继续独立检验。
- Android API 36 飞行模式：`android-high-01` 首学；`android-high-review-02` 失败/修复/重测及独立进程恢复。
  `android-high-final` 最终辅助回想路径及冷启动也已验证。
  冷启动验收使用 `--no-uninstall`，避免 Flutter 测试清理卸载应用删除验收库。

验收库和打包音频位于应用沙盒或 `/tmp`，不提交到 Git，不涉及 owner 的正式库。
无付费 LLM/TTS、云端部署或推送。根级 typecheck/build/lint、Rust workspace、Clippy 与 Flutter analyze 均在本轮执行。

## 可重复执行

在仓库根目录执行 `npx tsx scripts/sensaNativeBuildRuntimeArtifact.mts /tmp/sensa-runtime.json`。
历史到期库由 `cargo run -p sensa-library --example assurance_fixture -- /tmp/sensa-runtime.json /tmp/fresh-assurance.sqlite`
通过公开命令生成，拒绝覆盖已有库。

将验收 artifact 放到应用沙盒 `local-acceptance/assurance-<run>.sqlite.artifact`；复习验收另外放入同名历史 sqlite。
在 `apps/sensa_native` 运行 `flutter test integration_test/assurance_learning_test.dart -d <device> --no-uninstall
--dart-define=SENSA_NATIVE_RUN=<run>`。复习追加 `SENSA_NATIVE_REVIEW=true`，独立进程恢复追加
`SENSA_NATIVE_RECOVERY=true`。macOS 使用容器 Application Support；Android 通过 adb run-as 向验收路径写入。
不能把模型密钥或整包媒体塞入 Dart defines。

## 仍保留的迁移工作

正式 Activity/Mixed、每日组织/签到/记录/去重汇总、个人语义世界与快慢轨、本地采集交接、
在线 LLM 任务协作、Policy Migration、正式导航以及备份/同步仍按原清单推进。
本轮发布物准入不等于迁移上游内容生成与发布治理。Windows/iOS 实际运行尚未验收。
