# Sensa standalone 剩余迁移与上线计划

> Status: active launch plan. Date: 2026-09-05.

这不是旧 flashcard 仓库的迁移编号计划。独立仓库已经有干净 `0001_sensa_baseline.sql`、
Sensa API/Web、内容校验器、Sync v2 和首位用户本地纵切；下列工作是从本地纵切到公网
V1 的剩余事项。

## 已完成 extraction

- Sensa domain contracts、pure Learning Kernel、FSRS adapter seam 和 package validator；
- Catalog/Planning/Encounter/Media/Sensa Sync v1/v2 API；
- clean standalone Postgres baseline，内部暂保 LearnerScope compatibility seam；
- React Web 与 Sensa-only IndexedDB/outbox；不背单词式首页、我的内容、词书、义项详情、
  例句卡和学习 Encounter；
- local first-user content import、sync-repair/restore tools 和仅复制已导入音频的
  gitignored `runtime-media`；
- 完整 production content snapshot 已交接到 `content/data`：30,034 个文件、
  552,857,219 bytes；`content/data/MANIFEST.sha256` 完成源/目标逐文件 SHA-256
  比对（manifest 文件 SHA-256：
  `c95ed73906d0b8f6d65a43973f8351bbbeb18a1851944bce5ad156d53373344d`）。生产-only prompts、schemas、Profile/text/review/TTS/package/release tools
  已在 standalone 内闭合，日常命令默认不依赖外部仓库；
- canonical domain glossary、architecture、personal semantic world、learning connection、resource/runtime
  models 与本文件。
- learning extensibility 的 v2 语言无关合同与 Web behavior vertical slice：Retention Scope/Profile/
  Protocol Run/Initial Completion/Handoff schemas，scope/content/orchestration/renderer/store registries，
  可复用 Catalog Package 与 learner-specific Runtime binding 的分离，以及以 `retentionTargetId`
  为唯一调度键的本地队列、FSRS 与 Relearning smoke。Postgres/API/Sync
  的权威持久化迁移仍属于下方 gate 1。

## Remaining launch gates

1. **Learning connection migration**：用新版本合同实现 Learning Target、按 learner × Sense ×
   target expression 隔离的 Retention Target、Published/On-demand/Hybrid
   Content Provisioning、不可变 Learning Materialization、三种 Protocol Purpose、Protocol Step/Instance
   与 transition、Card Presentation renderer、Lightweight Initial Learning/Retention Review/Relearning、
   Initial Learning Completion/Study Completion、原子 Scheduling Handoff 与 Relearning Completion、
   `mixed | review_only` Session intent、protocol-aware Planner inventory，以及带 basis/evidence level 的
   FSRS initialization、one-review-one-update，以及协议声明的 scheduler-eligible Relearning
   Memory Outcome。发布新的 Runtime Rule Packet、
   Curriculum/Runtime persistence contract 与 Sync contract；pre-redesign first-user 进度可丢弃，历史
   Packet 保留只读重放，不得静默改义。
2. **Personal Semantic World 与 LLM roles**：实现 Personal Meaning/Focus/Anchors、中文 Sense
   Construction 对话、learner confirmation、stable Sense/Version/Alignment、显式 Add-to-Learning，
   并将 Semantic LLM 与 Learning Content LLM 的 policy、输入、输出、审计和失败恢复分开。模型建议
   不得自动创建个人成员、Learning Evidence 或 Curriculum Membership。
3. **Content**：为 On-demand Lightweight Study 建立最小内容角色、生成 policy、冻结时点、确定性
   schema/validator、provenance/digest 与 post-response immutability；Published Package 继续作为
   可复用/fallback 路径。从 `content/data` 保留可重建 release source，外部 snapshot 只允许通过显式
   operator seam 导入。当前 438 Senses / 249 Lexemes、424 个可执行 Package 是迁移与内部验证库存，
   不是首版个人语义闭环的数量门槛；它们只有在进入 Structured Acquisition 时才需要完整 Gate
   capability validator。
4. **Identity**：实现 Cognito email/OTP、Account ↔ Learner 1:1 binding、Account Session 与
   `active | deletion_pending | deleted` lifecycle；保留 LearnerScope adapter 作为授权 seam，移除
   `AUTH_MODE=none` 的公网可能性，并且不向产品暴露 Workspace。
5. **Settings/Data Control**：实现 typed/versioned Learner Preference、明确的本机 Device Preference、
   派生 Sync Health、pending-outbox-safe sign-out/Local Data Clearance，以及幂等 Data Export/Account
   Deletion Request。删除需在线重新授权、撤销 Sessions/Replicas、阻止旧离线 outbox resurrection，
   并按策略完成 learner-owned data 删除或匿名化；V1 不提供全量 learning-history reset。
6. **Data/Media**：将 Postgres 迁移到 Neon，将 immutable release media 迁入 R2，保留
   digest、license、cache headers 和授权下载检查。
7. **Hosting**：Cloudflare 承载 Web/API edge；建立 secrets、TLS、CORS、rate limit、
   migration/rollback 和 CI/CD。AWS/Cloudflare/Neon/R2 不在本地执行部署。
8. **Telemetry**：记录可解释的同步失败、operation replay/conflict、Encounter funnel、
   content/media misses、Preference conflict 和 Data Control status；不把 Product Event 当作 Learning
   Evidence，也不记录 credential secret。
9. **Reliability**：真实多 session、多设备 Sync、cursor expiry/bootstrap/replay、Materialization
   replay、Protocol Run/Step Instance resume、Initial Completion/Handoff atomicity、Scheduling Handoff
   idempotency、Retention Target isolation、one-review-one-FSRS-update、Relearning no-reinitialize/
   no-review-rewrite 与 relearning-outcome idempotency、media range、pending sign-out、local
   clearance/rebootstrap、Account deletion barrier、备份恢复和
   公网 smoke；没有 orphan/state corruption 或 deleted-account resurrection。
10. **Flutter**：Web/API contracts 稳定后，在 `apps/mobile` 建 Flutter 单一 iOS/
   Android/桌面 client。SQLite 是本地事实源，outbox 遵循 push→pull；Flutter 只做
   Action renderer、local state、音频/安全存储/通知适配，不复制 Semantic Policy 或
   FSRS。移动端与桌面端共用这一个 Flutter client；正式 Web 端继续 React，按 Web
   平台特点另行设计，不承诺复用 `web-next` 原型 UI——跨端资产是领域文档、实现
   seam 形状与 smoke 规格。

## Contracted post-core extensions

这些能力已经进入 canonical domain model，但不是当前 P0 launch gate；实现时仍必须先完成
language-neutral persistence/API/Sync contract，不能直接把原型本地状态接入生产：

- 实现 Structured Initial Learning/Relearning Protocol 的 Acquisition Cycle、baseline/conditional Gates、
  interference pacing、behavioral Evidence、5D projection、Graduation handoff 与 structured
  Review-originated Relearning，以及
  protected assessment inventory 和高保证 Package validator；它不能反向成为 Lightweight Study 的
  普遍前置条件；
- 发布与校验 Semantic Field Version、Field membership 和同 release Sense Relations；
- 实现 Study Plan 下的 Book Enrollment/Range、`active | maintenance | paused` lifecycle、
  Supplemental Curriculum/Membership 与不可变 Study Scope Revision；换词书默认保留旧 Enrollment
  的 maintenance，Scope 变更不得重置 Retention Target progress 或静默改变 active Session；
- 让 Add-to-Learning decision 区分 `accepted`、`already_in_scope`、`content_unavailable` 与
  `declared_mastery_conflict`，Supplemental Membership 在 Scope Revision 中解析到固定 Learning
  Target、Retention Target、Content Provisioning path 与 Learning Protocol，并对 Book/Supplemental
  多来源 Retention Target 去重；
- 实现 Saved Sense/Example、每 Sense current Note、Personal Semantic Anchor、Personal Collection/
  typed Membership、显式 Add-to-Learning Intent 与可重建 Learner Semantic Projection；
- 保证 unsave、Note/Anchor deletion、Collection membership/deletion、Practice 与 Add-to-Learning
  operations 相互独立，并对文本、顺序、revision、tombstone 与冲突提供跨设备收敛；
- 验证 Book switch、Range/mode change、Supplemental add/remove 的 revision、幂等、并发冲突与
  `push → pull` 收敛；同一 learner 不得出现两个 active Enrollment 或两份当前 Study Scope；
- 实现 Practice Brief、稳定 Practice Scope snapshot、四个 Practice Area、versioned Activity
  Definition、Free Practice Session，以及 Practice Turn/Observation/Feedback/optional Artifact；
- 首个 Profile 每个 Area 只交付一个 Activity：YouGlish 真实语流泛化、情境口语排演、语境推义与
  情境书面表达；其中 form-level YouGlish occurrence 不得冒充已完成 contextual Sense disambiguation；
- 让每个 Activity 固定 primary Area、stimulus/response channels、typed target、resources、support、
  interaction、feedback 与 session policy，并对 provider/AI/ASR provenance 与 unavailable state 做验证；
- 保护 reserved novel-assessment assets，并验证任何 Practice Turn、Observation、Feedback、score 或
  Artifact 都不能产生 Learning Evidence，或改变 Gate、5D、phase、due、daily quota 与 FSRS；
- 建立带 provider/edition/locale/license/digest 的不可变 Reference Release，以及 Reference Lexical
  Unit/Reference Sense 的稳定身份；不要把宽覆盖词典全部强行迁入当前 Sensa Lexeme/Sense 表；
- 建立 reviewed/versioned Sense Alignment，支持 `equivalent`、`reference_broader`、
  `reference_narrower`、`overlaps` 与无映射状态；只有 aligned stable Sensa Sense + executable
  provisioning path 可以加入学习；
- 为 immutable Example 生产 exact single/multi-token Lexical Occurrence annotation：target occurrence
  沿 authored Sense binding 确定解析，其他 occurrence 通过 closed candidate WSD 保存
  `reviewed | model_confident | ambiguous | unresolved` 与 resolver provenance；
- 实现全局 lookup/search 与 `Example + exact span` Contextual Lookup read API、可重建 search index、
  Reference detail、离线 release/index 安装及版本固定；运行时 fallback 按 example/span/release/resolver
  缓存，不能自由生成 definition；
- 生产并校验 source-backed root/affix、etymology 与 lexical-family enrichment；Etymology Story 与
  Mnemonic Aid 保留 source/editorial provenance，并与语言事实分层；
- 为资源建立 `reference_visible | learning_only | assessment_only` 边界，验证 active assessment
  提交前无应用内查词泄露，lookup 不改变 Progress/Gate/5D/FSRS/Scope/quota；
- Reference 详情只呈现真实存在的释义、例句、用法、构词词源和相关区块；仅对齐 Sensa Sense 时
  挂载现有 Personal Content Note，不为 reference-only meaning 伪造通用笔记；不引入“真题”、
  考试语料或虚假 provider 品牌/占位数据。
- 后续可提供多设备 Account Session 列表、逐设备远程撤销、安全活动历史与独立 Notification
  Preference；在明确建模前不把通知权限、提醒时间或学习历史 reset 塞进通用 settings bag。

## Compatibility and retirement

没有旧 flashcard 用户数据需要迁入独立 Sensa。当前 first-user 学习记录是可丢弃测试数据；
生产上线前重新导入/重建即可。旧仓库、旧通用 IndexedDB、Cards/Decks、generic sync、
generic AI/MCP product surfaces、AWS CDK 与历史实验不属于 standalone runtime，不能作为 fallback；
受领域合同约束的 Semantic/Content LLM 角色不属于该排除项。
