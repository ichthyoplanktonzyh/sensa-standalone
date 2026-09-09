# 原生个人语义世界：本地已知 Sense 纵切

2026-09-09；延续 Owner 对完整原生迁移、Focus 可选与快慢轨的确认。按已确认 Web 保存/收件箱/选义/接受/移除恢复/显式入学体验施工。

本轮结果：不要求设置学习数量即可保存文本 Context；Expression 可缺省并在收件箱补选；选择本机已有材料所固定的 Sense/Binding 并明确接受后，才创建 Personal Meaning。快轨可不经过 Inbox，缺义时停留 Inbox；Focus 可选，不制造 Proposal/Construction。确认源快照不原地编辑，更正通过保留原件的新捕获处理。

模块：Rust `personal.rs` 负责 Capture 校验、身份去重、接受、membership 和学习桥；schema v8 保存原始捕获、个人意义及 provenance。Flutter `personal_world_screen.dart` 提供列表/收件箱/已移除、文本捕获、表达 occurrence 选择、已知义项预览、确认和显式入学。既有 LibraryRepository/CAS/FFI 作为同一权威入口，主学习页只增加访问入口。

真实依据：consumer/intake.ts 的 Unicode code-point span、HTTP(S)/YouTube locator 和 captureIdentity；API personal/intake.ts、semantic.ts、membership.ts 的去重、直接接受和可恢复 membership；Web IntakeInboxDrawer / PersonalMeaningComposer / SensaSemanticWorldScreen 的入口职责。保持原始 provenance、个人接受与正式学习相互独立。

本轮不冒充完整语义世界迁移：在线 LLM lookup/澄清/Proposal 生命周期、图片/音频、图谱、Anchor Use 的在线任务重建、浏览器/Agent transport 仍逐项保留。Policy Migration 源码盘点未找到现有 Web 实现，领域也标为未来能力；登记为蓝图扩展，不为迁移完成而补造新功能。

验收：UTF-16 输入长度与 code-point occurrence、YouTube 来源校验、重复捕获保留第一次 provenance、Context-only 不创建 Meaning、Focus 缺省直接接受、无匹配不误收、接受事务回滚/重放、移除恢复不影响学习、显式入学同 Target 去重及 macOS/Android 离线与独立进程恢复。无付费服务调用、不迁移 Owner 数据。
