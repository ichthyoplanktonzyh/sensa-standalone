# Borrow / lend 高保证包：本机使用

2026-09-11 已接入当前 Web 学习包目录。

1. 打开 3001 的“我的学习 → 添加学习”，刷新学习包列表。
2. 选择 **Borrow & lend · 高保证学习**，下载后点击“加入学习”。
3. 点击“去学习”，也可以从包内 borrow / lend 的详情开始。
4. 首次开始时确认每天新增数量。此包固定高保证方法：经验建立后，依次接受执行器
   安排的识别、回想、迁移、边界及必要修复。发音和教学例句在表达揭示后可播放。

也可以点击“导入学习包”，选择本机生成的
`release-candidate/borrow-lend-assurance-v1.json`。导入只安装资源，需要再次明确加入学习。
已有八词轻量包仍保留；同名词在这两个发布来源下的 Sense 版本及方法不同，不自动合并历史。

开发者重建：先构建 learning-kernel、contracts、content-validator，再执行
`npm run sensa:build-assurance-package`。该命令只使用现有发布 JSON 和
`content/data/media/audio` 中经哈希验证的音频，不生成音频、不调用模型、不部署。
输出为 `release-candidate/learning-packages/<id>-<sha256>.json` 与独立的
`release-candidate/assurance-catalog.json`。云端如需此包，应通过现有 CI/CD 交付资源
并合并正式目录；本轮只更新本机试用目录。

## 卡片接线修正（2026-09-11）

首次接入时另写的简化运行卡片已移除。当前直接使用既有 `IntroductionCard`、
`RecognitionCard` / `SensaRecognitionCard`、`RecallCard` / `SensaRecallCard`、
`NovelTransferCard`、`SensaReviewAssessmentCard` 和 `SensaReviewFeedbackCard`，
复用原场景 renderer、学习界面主题、例句页、词典及个人连接入口。

运行界面通过现有 Learning Policy Profile 的 `runtimeAdapterId` 选择；已保存的本地
协议版本由 `localRuntimeBindings.ts` 显式兼容。卡片使用已有 `StepRendererRegistry`
合同登记数据适配函数，由队列编排产生的 `stepKind` 选择，不在页面按能力重新分支。
这不是新增学习方式框架，也没有重写队列、Gate、FSRS 或改变既有学习历史。

新增的可选 `CardExecution` 仅传递原始作答、提示、跳过及继续事件。正式提交在本地事务
中校验；首学回想的错误输入按原交互逐级进入首字母、选词提示。提示状态、反馈和正式进度
可刷新恢复；未提交的输入/选项仍是卡片内部草稿。原有其他调用方继续使用原回调合同。
原卡片界面文案已纳入中英资源，学习包中的中文教学内容保持发布内容原样。

## 2026-09-11 运行时接线修复

安装包运行时现在复用 `LearnScreen` 原有外壳、滚动区以及
`stepRendererRegistry` 的原始结构化卡片。删除了另建的
`originalStepRendererRegistry`；`AssuranceRuntime` 只适配已安装包的冻结资源、
本地原始回答命令和例句数据。原始笔记、场景、词典与偏好入口同时接入轻量运行时，
揭晓前不通过菜单泄露目标表达，查看与编辑个人内容不产生学习结果。

已会声明使用本地可撤销命令暂停规划资格，不伪造毕业、修改 FSRS 或删除已有运行。
高保证撤回通过原队列的 checkpoint 恢复并追加原始操作日志；备份重放包含撤回。
场景和词典页面补齐中英文，修正原卡片静态底部按钮的错误横向位移。

验证：真实 borrow/lend 发布包 + 合成账号的本地浏览器检查覆盖四类检验、
笔记/场景保存重开、例句返回、偏好、暂停恢复、轻量包同类入口、中英文及窄屏；
本地事务检查覆盖声明/撤销后恢复原运行、撤回、重复/迟到提交、单次调度和备份重放。
没有调用付费模型或部署服务。笔记与场景继续使用原有本机服务，未迁移为
新语义三元组或加入本地学习库备份；这次恢复入口不代表那部分数据迁移已完成。

## 2026-09-11 执行扩展接线与 FSRS 决策

Owner 确认保留当前真实轻量学习的 FSRS 行为与历史，不恢复旧原型固定档期。
本地事务的 start/act 与备份重放统一从原 `LearningRuntimeCoordinator` 解析
Profile → Protocol Binding → Adapter；移除了事务与备份中的方法专用执行分支。
原 Adapter 增加本地事务端口，端口复用原轻量首次学习 Step graph、
`LearnQueue` / `ReviewQueue`，不增加队列或编排表。结构化队列从原
`OrchestrationRegistry` 取得实际编排，作答通过原队列的 settle 入口结算；
该入口保留提示后回忆的支持等级，不把提示成功当成独立回忆。

原 `RuntimeSurfaceRegistry` 接收本地数据适配组件，删除 PackageRuntime 独立
Surface 选择表。高保证 Target 专用详情页也已删除，复用原
`LearningTargetDetailScreen`，保留发布资源和音频。App 的已选方法与偏好从
Profile 读取，不再根据 assurance 字段选择学习方式。

新运行固定 Profile 版本、完整 Protocol Binding 和调度配置；现有 Profile registry
可以保留归档版本供重放解析。更新 Profile 时必须保留仍被引用的旧版本定义。
当前轻量的配置保持 FSRS-6、0.9 retention、空学习/重学短步、关闭 fuzz；
配置由 Profile 传至既有结算函数。旧记录不补写字段，通过集中兼容入口读取，
继续得到原调度与事件结果。原型的 fixed_ladder 存储端口作为历史回归实现保留，
不用于当前本地学习库的 FSRS 事务。

验证新增 Profile 复用现有 Adapter/Surface 后完成首学并转为到期复习资格，
以及归档版本解析、严格原始动作校验和新旧两种记录格式的重放。
“配置复用”指复用已有执行能力；全新学习行为仍须实现原有扩展接口。
四阶段原型尚未绑定当前本地事务端口，本次未将其冒充已交付学习方式。

## 四阶段原实现接入验收（2026-09-11，接续上节）

Owner 确认：仅为尚未开始的结构化学习目标开放学习方式选择，可选高保证或四阶段。
已开始目标的方式、运行与历史固定，不改写已有 borrow/lend 的高保证记录。

本机入口：目标详情 → 学习方式「更换」→「四阶段交错学习」→ 完成选择 → 开始学习。
要体验目标间穿插，应在开始前将至少两个尚未开始的结构化目标选为四阶段；
系统从已加入学习、资源满足要求的同方式目标中，按每日新学余量组成运行。
只有一个合格目标时仍可完成四阶段，但不会假称目标间穿插。

本次验收发现前次本地运行端口仅支持单 Target，不能完整承载原四阶段队列。
已补齐通用多 Target Run：固定参与目标、材料和调度触发版本；事件归属于当前
Target，完成记录按 Target 投影，整个运行通过同一事务入口和备份重放入口处理。
新增协议使用通用 protocolState / protocol response，由注册 Adapter 校验；
通用 start/act、备份和页面选择中没有按四阶段方法身份分支。

直接复用原 `InterleavedFourStageQueue`、`InterleavedFourStageReviewQueue` 与两张
原 `InterleavedFourStage*Screen` 页面。队列只增加 checkpoint 导出/恢复能力，
页面增加受控数据端口，使用本地端口时不再创建另一份内存队列或由 UI 提交学习结果。
没有新增替代页面、卡片或第二套队列/编排登记表。原页面补齐中英资源，移除面向开发者的
结果解释，并补足已有运行时样式的文字、按钮尺寸和导航间距。

初学保留词义选择、语境回想、听音辨义、终关回想和原穿插次序。选项在事务内按冻结资源
评价，自评仍是自评；失败只重置该目标当前轮次，详情反馈不授予通过资格。
每个目标毕业独立初始化一次 FSRS；一次到期复习产生一次分级 Outcome，
遗忘后的队尾重学沿用原 ReviewQueue，不产生第二次原复习调度。

验收证据：`sensa:four-stage-local-smoke` 使用已发布包与 fake IndexedDB，覆盖双目标
穿插、单目标重置、逐动作恢复和重放、非法回答、重复/迟到提交、事务回滚、已开始后禁止
改方式、目标独立毕业、Again/Hard/重学以及加密备份在全新库恢复。
`sensa:four-stage-browser-smoke` 使用合成账号、真实发布资源与本机 Chrome，覆盖方法选择、
四阶段原页面、失败重试、播放音频、刷新/暂停恢复、窄屏、中英文和模拟到期后的复习/重学。
未调用付费服务、未操作真实用户数据、未推送或部署。轻量/高保证的事务及浏览器回归也通过。
