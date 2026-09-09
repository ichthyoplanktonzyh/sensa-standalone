# 本地个人语义世界：收件箱与已有 Sense 接受

2026-09-09；LF-1b 迁移增量。范围是本机文本捕获、已有词义的快轨/收件箱闭环，不代表全部语义世界或在线澄清已经迁移。

## 原实现依据

- `packages/contracts/src/sensa/consumer/intake.ts`：CaptureSnapshot、Unicode code-point occurrence、来源/YouTube locator、captureIdentity、来源定位链接。
- `apps/api/src/sensa/personal/intake.ts` / `semantic.ts` / `membership.ts`：重复捕获保留首次 provenance、接受与入学分离、已确认项移除/恢复及学习历史隔离。
- `apps/web/src/experience/components/IntakeInboxDrawer.tsx` / `PersonalMeaningComposer.tsx` / `SensaSemanticWorldScreen.tsx`：保存材料、收件箱、明确选义、已保存列表等入口职责。
- `personal-semantic-world-model.md`：Context–Expression–Sense 闭合才创建 Personal Meaning，Focus 可选；既有 Sense 直接接受不制造零轮 Proposal/Construction。

## 用户行为与本地权威

1. 从“我的词义世界”保存英文上下文，无需在线账户或先设置学习数量；Expression、来源名称和 HTTP(S) 链接可暂缺。
2. 未选义的材料进入收件箱。表达重复出现时必须选择 occurrence；原文用 Unicode code-point span 定位。
3. 展示本机已导入材料中的对应词义、参考场景和真实来源，由用户明确选择并确认。
   匹配候选本身不是接受；没有本机候选时保留收件箱，不伪造 Sense 或把自由文本解释当成已接受词义。
4. 具备 Context、Expression、已有 Sense 的捕获可以直接确认保存，不先造一个收件箱项目。
5. 接受同时记录 Context/Expression anchors、Alignment、Acceptance、固定 Sense/Binding version 和本机材料 digest；Focus 默认 null。
   收件箱补选表达时保留原始捕获，接受快照另行固定。重复捕获不以新标题/捕获时间覆盖旧来源。
6. 保存不会入学、签到、产生 Evidence 或调度。显式“加入学习”复用既有目标和计划；相同 Sense–Binding 的多个个人来源不复制学习身份。
7. 移除是可恢复 membership；恢复不重建 Target 或重写学习历史。已确认的原文不原地编辑，“以此重新保存”保留原记录。
8. 列表可搜索，原始来源链接可复制；YouTube 链接由捕获 locator 派生到秒。原有浏览器 transport 本轮尚未连接本地库。

Rust `personal.rs` / schema v8 与既有 library CAS/operation ledger 共用事务；Flutter 通过 JSON FFI 消费读模型。
`personal_learning_links` 保留显式个人入学来源。数据库升级只新增个人内容表，不改写既有学习事实。
新增 `url` 依赖用于解析 HTTP(S)/YouTube 来源；root 与原生桥 Cargo.lock 同步固定，原第三方许可保留。

## 验证

- `sensaNativePersonalParity.mts` 直接调用现有 TS Capture 合同，45 个来源/Unicode/YouTube 输入与 Rust 校验、identity 和定位链接对照通过。
- `personal.rs` 集成回归：无需数量保存、Context-only 不建 Meaning、无 Focus 直接接受、首次 provenance、原始捕获保留、失败回滚/操作重放、表达错位拒绝、移除恢复及个人来源共用 Target；原生其余回归同时验证 schema 升级不破坏旧行为。
- `personal_world_test.dart`：界面完成收件箱补表达/选义、快轨保存、移除恢复、两条来源共用一个 Target、显式入学并完成一次学习；独立进程比较完整已提交快照。

| 验收 | 结果 |
| --- | --- |
| 既有 34 项 Rust library 回归及本轮 5 项个人内容集成测试 | 通过；schema v7 升级另核对完整快照与操作回执不变 |
| TS/Rust Capture 合同对照 | 45 项通过，含 nullable/required 与非法确认字段 |
| macOS 实际流程 / 独立进程恢复 | `mac-personal-01` 均通过 |
| Android 实际流程 / 独立进程恢复 | `android-personal-02` 均通过；飞行模式为 1 |
| Flutter analyze | 无问题 |
| Rust workspace Clippy（all targets/features，-D warnings） | 通过 |
| 原生桥 cargo check --locked | 通过 |
| 根级 npm run typecheck / build / lint | 通过 |

Android 使用 `--no-uninstall` 保留独立验收库；小屏列表需滚动后再定位懒加载的词义控件，测试已覆盖。
全轮没有调用付费 LLM/TTS、没有运行 Hono，也没有迁移 Owner 数据、推送或部署。

复现：在 `apps/sensa_native` 下运行
`flutter test integration_test/personal_world_test.dart -d <device> --no-uninstall --dart-define=SENSA_NATIVE_RUN=<fresh-run>`，
再用同一 run 追加 `--dart-define=SENSA_NATIVE_RECOVERY=true`，比较本机保存的完整快照。
合同对照从根目录运行 `node --import tsx scripts/sensaNativePersonalParity.mts`。

## 尚待迁移

本轮是已知本机 Sense 的文本闭环。在线 lookup/澄清/Proposal 及 Sense 构造、图片/音频材料、未提交编辑草稿的自动恢复、图谱与表达多分支、Anchor Use 授权及任务更新、浏览器/Agent transport 都仍保留在完整迁移清单；不把文本列表当作这些能力已完成。
仅支持与已有 binding surface 大小写兼容的显式选义，词形解析与模糊候选仍属于 resolver 迁移。
个人读模型沿用 consumer 上限（500 条收件材料、500 条确认词义），超限拒绝并回滚；不静默截断或删除。

本轮额外核对：`learning-connection-model.md` 明确将 Learning Policy Migration 定义为未来能力，Web/TS 源码没有现有执行实现。
它继续属于完整产品蓝图，但应与“已有 TS 成果迁移”分开登记，不能为了关迁移清单而补造新行为。
