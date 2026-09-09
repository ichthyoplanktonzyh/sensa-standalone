# Runtime scope 与自由练习整组合同

2026-09-09：Owner 确认按整组推进，复用既有 Web 体验与领域规则，主代理直接实施，整组验收后交付。

源码依据：experience/learningRuntime/retentionScopes.ts、practiceScope.ts、usePracticeScope.ts、
practiceInventory.ts、components/PracticeScopeScreen.tsx、YouGlishListeningScreen.tsx、useYouglishWidget.ts。
领域依据 learning-runtime-model §8、learning-connection-model Retention Target、PRD §7.2。

- Rust core 迁移 RetentionScopeRegistry：唯一 default、四项 independent admission、稳定 target ID、
  一层 prerequisite、显式选择与依赖排序；对实际 TS 源做差分。当前正式产品仍只注册语义连接 scope；
  不发明新的独立能力、重写旧 UUID 或为同一题型增加 Memory。组合入口校验使用该 Registry。
- Rust library 提供单独 practice Query/Command 与 SQLite 事务，不复用正式 Command 的 Activity/
  quota/Introduction/Outcome 结算钩子。选择持久化；current_study 来源读取课程范围，personal 来源读取
  active accepted Context–Sense–Expression，无需入学。失效个人选择按现有 Web 规则回退当前学习范围。
- Free Practice Session 固定 Brief、Scope、Profile/Activity/Inventory 与 provider 来源；开始前能力校验，
  练习中的来源变更不重绑旧 Session。退出暂停播放器，保留/恢复或明确结束。Turn 仅记录练习导航和
  provider 回调，不产生学习 Evidence、FSRS、签到或 quota，也不自动收藏/入学。
- Flutter 本机选择/历史离线可用；YouGlish 是明确依赖网络的 provider。原生 WebView 承接现有 Widget
  API、表达去重、口音/速度、上一段/下一段、重听、播放暂停、字幕、错误/空结果/重试与来源说明。
  不复制演示数据为个人范围、不声称片段已被 Sense 消歧，不开放没有实际执行器的说/读/写占位活动。
- 正式学习可以原样恢复；练习入口不更改正式 Activity。外部播放回调只可记录 provider 观察，不能调用
  正式命令。网络错误不伪造成功播放；同形异音无法可靠约束时不进入泛化队列。

验收：TS 差分、非法 scope、个人未入学目标、空/失效范围、固定 Session、Turn 幂等/乱序/跨库拒绝、
formal facts 全表不变、旧库/回执兼容；真实 WebView 的无成本 provider fixture 两端主流程/冷恢复与
真实 provider 连通性检查。付费 LLM/TTS 不调用；不迁移 owner 数据，不推送/部署。
