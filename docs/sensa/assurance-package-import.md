# Borrow / lend 高保证包：本机使用

2026-09-11 已接入当前 Web 学习包目录。

1. 打开 3001 的“我的学习 → 添加学习”，刷新学习包列表。
2. 选择 **Borrow & lend · 高保证学习**，下载后点击“加入学习”。
3. 点击“去学习”，也可以从包内 borrow / lend 的详情开始。
4. 首次开始时确认每天新增数量。此包默认高保证方法，未开始的目标可在详情更换为四阶段。
   高保证在经验建立后，由执行器安排识别、回想、迁移、边界及必要修复。发音和教学例句在表达揭示后可播放。

也可以点击“导入学习包”，选择本机生成的
`release-candidate/borrow-lend-assurance-v1.json`。导入只安装资源，需要再次明确加入学习。
已有八词轻量包仍保留；同名词在这两个发布来源下的 Sense 版本及方法不同，不自动合并历史。

开发者重建：先构建 learning-kernel、contracts、content-validator，再执行
`npm run sensa:build-assurance-package`。该命令只使用现有发布 JSON 和
`content/data/media/audio` 中经哈希验证的音频，不生成音频、不调用模型、不部署。
输出为 `release-candidate/learning-packages/<id>-<sha256>.json` 与独立的
`release-candidate/assurance-catalog.json`。云端如需此包，应通过现有 CI/CD 交付资源
并合并正式目录；本机试用目录不代表云端已发布。

## 学习方式与运行时复用

未开始的结构化目标：详情 → 学习方式“更换” → 高保证或四阶段 → 完成选择 → 开始。
要体验目标间穿插，开始前给至少两个合格目标选择四阶段；仅一个目标也可运行，但没有目标间穿插。
已开始的目标保留其方法、材料、运行与历史，普通设置不执行 Policy Migration。

原 `LearningRuntimeCoordinator` 解析 Profile → Protocol Binding → Adapter，原
`RuntimeSurfaceRegistry` 和 `stepRendererRegistry` 选择已注册呈现。复用 `LearnScreen`、
`IntroductionCard`、Recognition/Recall、NovelTransfer、ReviewAssessment/Feedback 等原卡片，
以及原笔记、场景、词典、偏好入口；揭示前不通过菜单泄露答案。

Adapter 的本地执行端口只接收原始回答、提示、跳过和继续，由事务校验并提交学习结果。
提示成功保留其支持等级，不当成独立回忆。已会声明可撤销，只改变规划资格，不伪造毕业或修改 FSRS。
原卡片内部未提交输入仍是草稿；高保证撤回使用原队列 checkpoint 与事件日志，备份重放包含撤回。
笔记/场景仍使用原本机服务，未纳入新语义三元组或本地学习库备份，不能因入口已恢复而认为迁移完成。

新 Run 固定 Profile 版本、完整 binding 和调度配置，旧版本须保留供解析/重放。旧记录通过
`localRuntimeBindings.ts` 集中兼容，不补写历史字段。轻量使用 FSRS-6、0.9 retention、空短步、
关闭 fuzz；原型 fixed_ladder 只保留为历史回归，不恢复为当前本机调度。
复用已有执行/呈现能力可通过配置组合；全新行为仍需实现既有适配接口，不新增重复框架。

## 四阶段行为

直接复用 `InterleavedFourStageQueue`、`InterleavedFourStageReviewQueue` 和原两张 Screen。
通用本机 Run 固定多个参与目标/材料/调度触发版本，事件归属当前目标，完成按目标投影；
同一 start/act 和备份重放处理，不按四阶段身份增加专用编排分支。
受控页面不再另建内存队列或由 UI 提交结果，协议状态由 Adapter 校验与恢复。

词义选择 → 语境回想 → 听音辨义 → 终关回想，按原队列穿插。选项按固定资源评分，自评
保持自评；失败只重置该目标轮次，详情反馈不授予通过资格。目标毕业分别初始化一次 FSRS；
一次到期复习只产生一次分级 Outcome，队尾重学不产生第二次原复习调度。

## 验证入口与限制

- `sensa:assurance-package-smoke` / `sensa:assurance-package-browser-smoke`：包与原卡片接线、
  提示/撤回、原入口、暂停恢复、轻量回归和中英窄屏。
- `sensa:four-stage-local-smoke`：真实发布包配 fake IndexedDB；双目标穿插、失败重置、逐动作
  恢复/重放、非法/重复/迟到操作、事务回滚、方法锁定、独立调度与加密备份恢复。
- `sensa:four-stage-browser-smoke`：合成账号、真实发布资源、本机 Chrome；方法选择、原页面、
  音频、刷新/暂停、窄屏、语言切换及模拟到期的复习/重学。

这些是本地无付费验证，不代表真实用户库迁移或云端部署。历史修复过程可从 Git 追溯；
学习包数据与运行媒体留在 Git 外。当前范围与后续门见 current-stage。
