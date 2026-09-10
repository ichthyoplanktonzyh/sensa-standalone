# 本地文本学习包导入与多目标入学

日期：2026-09-08；LF-1b 的有界实现合同。领域规则仍由七份领域文档裁决。

## 用户行为与现有来源

复用 `apps/web/src/experience/account/AccountCatalog.tsx` 的内容选择、独立“加入学习”、已加入状态和返回学习行为。目标选择不创建完成事实；导入文件不自动入学；已加入目标继续原 Run，不因切换或再次导入重置。

目前 Web 的公开目录、按需材料和资源发布有不同合同，尚无统一的离线分发归档。此次新增 `sensa-local-text-pack-v1` 作为本地文本快照传输格式，映射已有 `experience_recall_cue`、`target_expression`、`sense_confirmation` 的最小轻量呈现；不是将整套 Published Package schema 冒充已经迁移，也不能直接导入模型 Candidate Bundle。

参照来源：`packages/contracts/src/sensa/lightweightLearningContent.ts` 的前揭示非泄露规则、`consumer/target.ts` 的显式入学边界、`apps/api/src/sensa/runtime/initial.ts` 的继续/新学数量规则。完整角色化 Materialization、音频、其他语言/协议、发布目录导出仍须后续迁移，不丢弃包内未知字段来勉强运行。

## 文件合同

例子：`crates/sensa-library/tests/fixtures/local-text-pack-v1.json`（明确标注合成验收材料）。

- 根字段：`format`、`id`、`version`、`title`、`protocolVersion`、`targetLanguageTag`、`familiarLanguageTag`、`learnerLocale`、`materials`。
- 本轮仅 `consumer-initial-v1`，英语目标和 `zh-CN` 熟悉语言/界面；未知格式、协议或语言拒绝。
- 单包 1–100 项、最多 2 MB；每项固定 `id`、`senseVersionId`、`bindingVersionId`、`scene`、`sense`、`expression`、`source`。ID 为 canonical UUID，文本非空且有界，不接受额外字段。
- Context/scene、Sense 与 Expression 必需；没有将 optional Focus 变为导入前置字段。
- Recall 会显示 scene 与 sense；两者经 NFKC、空白归一和小写处理后不得泄露 expression。
- 同包内不重复 material ID 或 Sense Version–binding Version 连接。本轮同一连接只安装一份材料；不同 material ID 的替换需要后续显式材料版本切换，当前拒绝而不暗中替换。
- 文件导入是用户主动采用本地内容，不是 Sensa 对来源的审核/签名认证。结构和完整性校验不证明语义质量，不把任意文件标为官方已发布资源。

## 事务与状态

`ImportPack` 在单一 SQLite 事务内验证并固定整包与逐项内容摘要。相同包 ID/version 不允许内容变化；相同材料 ID 也不可变。重复导入可重新确认操作，但不重复材料/Target/Run。后一项失败会回滚前面已处理项、包记录和操作账本，不出现半包。

库 schema v2 为 v1 增加 `selected_material_id` 与 `imported_packs`，不重写既有完成/调度事实。Catalog 是只读投影；每次操作仍有库隔离、revision CAS 与 operationId 去重。

`SelectMaterial` 保存选择并暂停未完成 Run；`AddToLearning` 只对所选材料入学；`StartOrResume` 恢复其固定 Run 或开始一个新目标。材料、Run、Completion、Memory 读取全部限定目标，禁止旧 `LIMIT 1` 造成串线。每目标的首次 Handoff 仍唯一。

新建初学 Run 按设备当前本地日检查每日数量；继续既有 Run 不再占新学名额。时间与时区偏移由 Rust 宿主取得，UI 不能传入结算时间或时区。持久的 Study Plan 时区和完整统一规划仍后续实施；用户跨时区旅行的长期口径需与之一起验收。

Flutter 文件选择器只读取用户选中的文件；macOS 仅增加 user-selected read-only entitlement。Repository/ViewModel 负责读取和操作反馈，Rust 负责合同、版本和事务；不上传文件，不要求账号。

验收证据见 `native-capability-status.md`。这条用例不代表复习/重学原生界面、一般 Published Package 导入或完整 LF-1b 完成。
