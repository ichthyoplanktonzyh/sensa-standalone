# 正式原生 UI 用例与证据矩阵

2026-09-09。状态：第 6 组施工与验收基线已建立，正式 UI 尚未验收。
Owner 同意沿用 apps/web 已确认体验并适配 Flutter 桌面/移动；测试策略已确认。
不重新设计领域、写 UI 自有调度、启动 Web 本地化或声称完成 M3。

## 实现依据和职责

`apps/web/src/application/Root.tsx` 区分 production 与 preview。正式视觉参考以 production
`experience/account/SensaApp.tsx` 及其实际消费组件为主；preview 中已存在的完整能力仍要盘点，
不能把 preview 存储当正式持久化，也不能因为 production 未开放而删除既有迁移范围。
视觉 token 来自 `apps/web/src/styles/tokens.css`。不使用 web-next 作为正式 UI 来源。

原生 `main.dart`/`ui` 负责布局、导航、状态呈现；`LibraryViewModel`、World/Practice model
和 data repository 继续作为消费入口；Rust 继续裁决接纳、入学、Protocol、事务与调度。
测试直接建前置数据仅属于测试安排，不是新增产品后门。

## 用例清单

下表“现有证据”指历史迁移测试入口，并非这次重新执行或正式 UI 已完成。
所有行的正式入口、桌面/移动适配与实际体验验收当前都为 **待执行**。
自动化入口的真实依赖、替身、恢复前置由 `npm run sensa:acceptance -- plan <组 ID>` 展开。

| 用例 ID / 用户结果 | apps/web 依据（src 下） | 原生现有入口 / 证据组 | 最后一组必须补齐的证据 |
| --- | --- | --- | --- |
| UI-01 初次打开、确认节奏、返回首页 | experience/account/SensaApp.tsx；components/HomeScreen.tsx | main.dart、library_screen.dart；native-learning | 正式首页空态；本机使用无需登录；正常入口没有“载入验收材料”；数量确认持久化；读库失败可恢复 |
| UI-02 内容导入、浏览、选范围、明确入学 | experience/account/AccountCatalog.tsx、AccountContent.tsx；components/ContentLibraryScreen.tsx | curriculum_screen.dart；native-pack、native-organization | 导入取消无写入、无效/旧版包有说明、详情与列表一致；正式页面可操作；另验 OS 文件选择器 |
| UI-03 选择学习方式并进入相应执行器 | experience/components/learning/LearningPolicyScreen.tsx、LearningEntryScreen.tsx | library_screen.dart；native-assurance | 默认/来源/单项策略继承、首次 Run 固定、未知组合 blocked；用户选择产生真实执行差异，不只换标签 |
| UI-04 轻量首学/复习/重学 | experience/components/learning/LightweightReviewRuntimeScreen.tsx；learningRuntime/lightweightInitialPresentation.ts | library_screen.dart；native-learning | 正式入口 → 回想 → 揭示 → Again/Good → 结算；暂停/继续；时间等待；重复操作不重复 Outcome/Handoff；冷恢复 |
| UI-05 高保证首学/复习/重学 | experience/learningRuntime/stepRenderers.tsx；components/learning/StructuredRuntimeSummaryScreen.tsx | assurance_view.dart；native-assurance | 实际任务/材料、修复/重测、辅助不冒充独立回想、学习总结与 scope；各变体独立执行；四阶段 UI 除外 |
| UI-06 今日学习、来源组织、记录与签到 | experience/account/AccountLearning.tsx、AccountLearningSummary.tsx；components/StatsScreen.tsx | learning_activity_view.dart、curriculum_screen.dart、history_screen.dart；native-organization | Mixed/Review-only、固定 Activity、每日额度、筛选与长列表；签到失败不阻断学习；历史和恢复无重复 |
| UI-07 保存上下文、澄清、接纳到语义世界 | experience/components/SensaSemanticWorldScreen.tsx、PersonalMeaningDetailScreen.tsx | personal_world_screen.dart、world_screen.dart、semantic_resolution_screen.dart；native-world、native-agent | Context/Sense/Expression 齐全、Focus 可选；缺信息保留待处理；老师澄清/改正；接受不自动入学；草稿和候选恢复 |
| UI-08 语义连接、详情与原文管理 | experience/components/ExpressionBindingScreen.tsx、ConfirmedSenseDetailScreen.tsx | world_screen.dart、anchor_use_panel.dart；native-world、native-preparation | 列表/展开/图谱、来源定位、移除恢复、同上下文多义、授权撤销和迟到结果保护；用户从正式导航可达 |
| UI-09 资源准备、审核、参考和音频 | experience/learningRuntime/contentAgentProvisioning.ts；components/ReferenceDictionaryScreen.tsx | preparation_screen.dart、reference_source_panel.dart、pronunciation_view.dart；native-resources、native-preparation | pending/失败/重试、独立审核后冻结、参考来源、文本回退、音频离线；不播放/不展示未准入内容；不误称宽词典已交付 |
| UI-10 自由练习 | experience/components/SensaFreePracticeScreen.tsx、YouGlishListeningScreen.tsx | practice_screen.dart；native-practice | scope、不可用/重试、退出恢复、真实播放器边界；正式证据/进度/调度保持不变 |
| UI-11 本地 Provider 与可选在线账号 | experience/components/ProfileScreen.tsx；account/SensaApp.tsx；原生 Provider 既有合同 | agent_screen.dart、provider_login_screen.dart；native-agent、native-vault、native-provider-account | 设置用途/连接、失败重试、退出、凭据失效；无账号仍可本地学习；模型和邮件实况单独记录 |
| UI-12 浏览器/Agent 交接和本机刷新 | 浏览器 popup/options；native-intake-group-plan.md | intake_connection_screen.dart；native-intake、intake-bridge | 目的地明确、取消无提交、错误库拒绝、断线排队、回执确认、重启重试、资料显示且不自动入学；实际安装/系统边界单列 |

以上是可追踪的关键任务，不按行数计算完成率。细分断言来自既有测试和领域规则；实现中发现
遗漏的已有 Web 行为需要补入对应行，不能以当前表行数冻结范围。

## 整组的跨模块旅程

1. 全新本地库 → 确认节奏 → 导入合成包 → 明确入学 → 选择已支持 Profile → 正式学习 →
   持久化结果 → 独立进程恢复 → 记录页面一致。
2. 采集完整提案 → 明确接纳 → 语义世界；另一份缺信息材料 → 老师澄清/修改 → 明确接纳 →
   显式入学 → 内容准备与独立审核 → 正式学习。校验每个边界不越权。
3. 已有学习库 → Provider/媒体不可用 → 展示失败/文本回退 → 恢复与重试；已有材料的离线
   学习可继续，结果只提交一次；自由练习不产生正式学习事实。

不要用一条很长且互相污染的测试代替全部用例。以上旅程可以各自使用隔离数据，相关功能
测试负责细致边界；跨模块旅程负责证明最终导航与页面接线，前置直接写入的步骤不得算 UI 通过。

## 桌面/移动与实际体验

- 按可用窗口宽度适配，起始检查 375×812、390×844、800×1024、1280×800（逻辑像素）；
  再检查至少一个大字体配置、键盘打开的长表单、长 expression/context 和空态/错误态。
  这些是布局输入，不代表四种设备已验收。可在组件层补精确断言。
- 桌面键盘 Tab/Enter/Escape、焦点可见、返回来源、滚动与窗口缩放；移动安全区、系统返回、
  键盘避让和触摸目标。关键界面保存截图供视觉审查，不强制所有页面像素快照。
- 分别记录 macOS 与 Android 自动化，独立冷启动与现场走查。Windows/iOS 不从构建或共享
  Flutter 代码推断通过。原生 OS 文件选择/权限、安装的 Native Messaging 是单独平台证据。
- 安装包向导、签名/商店分发和生产服务有其发布依赖。若未交付，明确留在发布门，不能在
  本组用命令行演示代替安装体验，也不能据此把正式 UI 全面标记完成。

## 结果记录格式

每次交付记录：用例 ID、代码 revision/是否有未提交修改、入口与命令、变体/平台/网络条件、
fixture 与真实边界、通过/失败/未运行、结果日志/截图位置、持久化断言、未覆盖项。
主流程与 cold recovery 分别记结果。自动化通过、代理实际体验检查、owner 体验确认各自记录。
新的正式 UI 只能引用它实际经过的测试证据，不能继承旧壳的通过状态。
