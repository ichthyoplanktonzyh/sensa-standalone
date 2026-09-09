# 原生可选学习资源与本机准入治理

2026-09-09，接续 Provider 组。[施工范围](native-optional-resources-plan.md)沿用已确认 Web
Lightweight Initial 的材料角色与揭示时机；本轮只迁移已有可选文本资源的本机供给/消费边界。

## 原实现依据与迁移结果

| 原实现 | 本机落点 |
| --- | --- |
| `packages/contracts/src/sensa/lightweightLearningContent.ts` 的四种可选文本 payload、角色数量 | `resources.rs` 的严格 schema、角色上限及 UTF-16 长度边界；10 项真实 TS/Rust schema 对照 |
| `lightweightInitialPresentation.ts` 的 practice/instruction 分离 | Flutter 仅在回忆阶段呈现 recall_support；揭示后呈现 language_structure、usage_guidance、scene_bridge |
| `lightweightInitialContent.ts` 的教学候选和 authoritative reference 来源区别 | Agent 只生成回忆提示/场景联结，全部进入独立审核；未附参考事实时拒绝模型伪造语言结构/用法来源 |
| `contentProvisioning.ts` 的 clone/freeze 与角色材料化 | 资源随 Material 固定 Sense/Binding、来源、摘要和版本；包冲突拒绝，不原位替换正在执行的材料 |
| `contentAgentProvisioning.ts` 的 optional omissions 与终态候选 | 新 Agent 结果记录缺失角色与 omission reason；独立审核摘要覆盖全部可选候选，Rust 提交前重新验证 |

`Material.resources` 是可省略、保持顺序的 role-indexed 文本资源，使用现有
`materialRoleKey` / `contentPayload` 词汇。缺省为空时不序列化字段，旧材料摘要和旧库不变。
资源的身份、目标版本与出处由所属不可变 Material 固定；生成路径另有完整任务/Attempt/
provider/review/trace 证据。不新增学习目标、Evidence、Memory Outcome 或调度。

本地文本包可以携带四类资源，沿用显式导入与版本保护。包导入不是平台发布审批，也不证明
用户提供的内容已获得平台审核。任意非法角色、重复单例、超过四条回忆提示、无效 payload
或回忆提示泄露目标表达，整包拒绝、无部分入库。回忆提示使用 NFKC、空白归一及大小写折叠
检查直接答案泄露；这不声称替代语义审核。

新内容尝试固定 `native-agent-lightweight-v2`；既有 v1 尝试保留原提示词和工具形状，不能借
版本升级追加资源。v2 候选可省略 resources，缺失可选内容仍可完成必需材料供给。生成器不能
自批，也不能改变 Sense、表达或 Profile；当前参考事实工具为空时明确不生成词性/用法事实。
任意可选候选不合格都反馈修正，不能把它悄悄剔除后宣称整个候选已审核。

## 本机治理与上游边界

本机负责准入、版本固定、拒绝非法候选、同版本冲突保护、恢复和按允许阶段显示。旧 Run、
已发生学习和调度不受可选内容导入影响。生成结果继承既有 Anchor Use origin 和撤销隔离；
原文细节与补充文本一并进入独立复核。

源码盘点表明，上游 `packages/content-validator` 的 authoring/runtime validators、
`content/tools/automated_review.py` / `validate_release.py` 和发布编译工具承担生产/审核职责。
这些 TS/Python 生产工具保留原位置，不在 Flutter 中复建发布后台；本轮未修改或执行付费审核。
高保证 release 的既有本机校验和已验收资源绑定继续保留。

完整资源迁移仍需收口：权威参考事实的真实供给与来源生命周期、图文原文的资源授权，以及
表达 relation/coverage 对内容准备合同的支持。现有非 exact/realizes 的准备阻塞保持明确，
不能因为补齐可选文本呈现就视为完成。流式展示、原生账户、采集交接、正式 UI 与同步继续
按迁移清单推进。本轮不声明整个资源组、完整原生迁移或 M3 已完成。

## 验收

- Rust 包事务：非法第二项整包回滚、NFKC 答案泄露、角色/数量/schema、版本冲突、进行中
  Run 固定、重开恢复、Reveal 不产学习结果及 Good 一次结算。
- Rust Agent：非法/无来源可选候选不进入审核；正确资源经独立审核后冻结，命令重放幂等。
- `sensaNativeOptionalResourcesSmoke.mts`：直接调用共享 Web schema 与 Rust driver，比对 10 项。
- `pack_import_test.dart`：真实两端 UI 导入包含四类资源的包，揭示前隐藏用法/结构/联结，
  揭示后显示；另一无可选资源目标正常学习，重复导入不改学习结果，冷恢复保持资源与账本。
- `agent_test.dart`：无成本真实 HTTP 工具循环、独立拒绝再修正、资源冻结与跨进程恢复。

macOS `optional-mac-a`、Android `optional-android-a` 的包导入/学习/同名冷恢复通过；最终
呈现顺序由 `optional-final-mac` / `optional-final-android` 再次检查，揭示后先显示表达和词义，
再显示辅助内容。Agent `optional-agent-mac-a` / `optional-agent-android-a` 主链及同名冷恢复
通过，冷恢复不增加模型 HTTP 请求，材料保留两项已审核资源。

Rust workspace all-features、Agent/包事务、Clippy all-targets、bridge locked check、Flutter
analyze 和根级 typecheck/build/lint 通过；既有真实 TS assembler → Rust 准入 smoke 继续通过。
新增字段通过现有 JSON seam 传输，无 FRB 公开绑定签名变更、无数据库表迁移。

只使用独立合成库，未读取 owner Key/资料，未调用付费 LLM/TTS。macOS 使用临时独立 bundle ID
和现有开发签名，测试后恢复配置、不提交签名身份；原 Release 进程保持运行。Android 不卸载，
飞行模式/Wi-Fi 状态保留，仅模型 fixture 使用 adb reverse，结束后移除转发；本地包测试不需网络。
没有推送或部署。

复现：`flutter test integration_test/pack_import_test.dart -d <device> --dart-define=SENSA_NATIVE_RUN=<unique>`；
Android 加 `--no-uninstall`，同名追加 `--dart-define=SENSA_NATIVE_RECOVERY=true` 做冷恢复。
Agent 测试先运行 `node --import tsx scripts/sensaNativeAgentSmoke.mts --serve`，按 Provider 交付中的
命令执行。schema 对照使用 `node --import tsx scripts/sensaNativeOptionalResourcesSmoke.mts`。

后续更新（2026-09-09）：本文所列资源供给、图文授权、关系准备、流式与原生在线账户事项，已由 [资源整组交付](native-resource-group-handoff.md) 接续；本文保留原轮次验收记录，当前状态以迁移清单为准。
