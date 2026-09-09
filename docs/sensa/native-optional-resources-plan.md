# 原生可选学习资源纵切

Owner 于 2026-09-09 授权继续迁移。沿用已确认 Web 学习体验：回忆阶段仅显示安全辅助提示，
揭示后才显示语言结构、用法和场景联结；可选缺失不阻塞、不改变调度。已有包导入/版本保护
和 Agent 生成/独立审核承担供给，Rust 冻结材料，Flutter 只呈现。

源：packages/contracts/src/sensa/lightweightLearningContent.ts，apps/web/src/experience/learningRuntime/
lightweightInitialContent.ts、lightweightInitialPresentation.ts。资源领域依据 sense-learning-resource-model.md
1.1–1.2。四种角色沿用 materialRoleKey/contentPayload 和 schema v1；发音保持现有独立来源校验。

本纵切承接四类文本资源的有界本地准入、包导入、不可变保存、UI disclosure 与恢复。模型只能
生成回忆提示/场景联结并经过独立审核；没有权威参考事实时不能伪造语言结构或用法来源。
包内结构/用法遵循现有显式本地导入边界，不能把用户导入宣称为平台审核发布。

Material 新增可省略 resources 数组，旧材料缺省为空并保持旧序列化摘要。资源继承所属材料的
Sense/Binding、来源、版本与生成任务审核证据，不创建额外学习身份、Evidence 或调度。
任何非法候选/越界数量/未知角色/揭示前泄露使整项拒绝；同版本包冲突拒绝，不覆盖旧 Run。

源盘点边界：上游内容生产/发布审批继续属于现有 TS/Python 云端工具，不为原生迁移造发布后台。
完整来源事实查询、表达 coverage 的内容合同及图文原文供给仍保留后续项，不静默放开当前阻塞。
验收为 Rust 包/Agent 事务、真实 TS schema 对照、macOS/Android 导入→学习→重启恢复，根级检查。
