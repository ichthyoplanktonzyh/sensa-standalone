# M1/M2 已确认 Web 界面接入

日期：2026-09-08。Owner 要求将 M1/M2 接回已确认界面，迁移后删除简化页面。
确认基线是 `apps/web/src/experience` 的既有桌面/手机 UI（M0-2 checkpoint
`5fee636e`），不是 `apps/web-next`。

## 本轮纠正

此前 M1/M2 的 Postgres、Sync v3、账号和 Provider 链路通过了本地验证，但
`application/AccountRoot.tsx` 使用了另外编写的简化首页和组合页面。
这些工程验证不能代表已确认界面的交付验收。Owner 体验时发现的差异已作为
M1/M2 的界面集成缺口处理；历史 handoff 不再可用于声称界面已完整验收。

## 接入与删除

- `experience/account/SensaApp.tsx` 组合已确认的 `HomeScreen`、`StudyScreen`、
  `ProfileScreen`、`StudyCalendar`、`StatsScreen` 与学习设置组件。读取账号独立
  replica，所有操作仍经 consumer API / 本机 outbox；不读写原型学习事实。
- 目录、目标库和详情复用 `LearningEntryScreen`、`LearningTargetLibraryScreen`、
  `LearningTargetDetailScreen`，接入真实候选、membership、readiness、已会声明和
  目标准备。查询与目标详情支持刷新恢复。
- 我的内容沿用已有页头、列表与抽屉布局；页头抽为共用 `ContentHeader`。
  个人意义、收件箱、手动文字、明确 occurrence、独立语义确认、关注点重解释、
  入学、原文授权/撤销和移除/恢复来自 M2 的真实对象。插件 intake/meaning
  链接定位同账号内容，确认后进入该意思的详情，刷新保留定位。
- 正式学习使用已有 `RuntimeFrame`、`ExperienceRecallCard`、`ExpressionRevealCard`
  和 `RuntimeRating`。授权材料决定提示与表达；隐藏/披露、离线授权、待确认、
  冲突、暂停、复习与重学仍使用服务端 Run 和本机耐久操作。
- 签到日历改为可由账号投影控制，显示待同步状态与账号时区；不将预览签到
  导入正式记录。完成记录使用服务端 `completed_at`，通过兼容的 optional
  `completion.completedAt` 字段传递；旧快照缺少时间时不编造历史时间。
- 删除 `application/AccountRoot.tsx`、`InitialLearning.tsx`、`IntakeInbox.tsx`、
  `TargetLibrary.tsx`、`CheckInCalendar.tsx`、`LearningActivitySummary.tsx`。
  `application/Root.tsx` 正常入口指向新的界面组合，未保留简化页面回退。

## 验证与边界

本地无付费验证：根级 typecheck / build / lint；Node M1/M2 集成；Deno Edge
兼容检查；Chromium 152 浏览器中的以下独立流程：

1. 首页、目录、账号、数量断网/丢响应、目标加入/刷新/已会声明、落盘失败不前进、
   离线回想与披露、暂停恢复、学习记录与统计、复习/重学、日历、退出；
   320/390/768/1280 视口检查及桌面/手机截图。
2. 手动定位表达、歧义澄清、刷新复用解释请求、确认、原文授权丢响应与重放、
   撤销、移除撤权、恢复保留目标但不自动重授原文。
3. 按需个人材料的静态发音，揭示前不泄露音频、缓存 MP3 离线播放、损坏媒体
   不妨碍文字学习与正式完成。
4. 实际 MV3 插件的 PKCE/同账号 Web、收件箱和原位确认、离线队列与重启、
   个人目标入学/准备/完成、A/B 账号队列隔离及原账号重授权。
   自动化仍只为本地采集 fixture 添加 host 权限，不替代原生 activeTab 历史证据。

浏览器检查先验证 `/__test/environment` 确实为 synthetic Auth + mock providers，
防止误把用户授权的真实 DeepSeek 体验服务作为自动测试目标。

本轮覆盖 M1/M2 已实现功能，并不把原型中 Later 能力变为生产事实。自由练习、
多轮个人语义建构、图片、收藏/笔记、完整账号数据控制和非 lightweight 策略等
未接通的能力仍不得假成功。界面恢复后的 owner 实际体验验收另行记录。

Owner 已暂缓云端部署和商店发布：本轮仅本地开发、验证与 checkpoint，无 push、
云端部署、商店上传或送审；这些外部验收不阻塞本地工作。
