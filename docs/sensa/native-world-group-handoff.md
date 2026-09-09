# 原生个人语义世界：图文、草稿、表达连接与投影

日期：2026-09-09。第 3 组本机内容与投影纵切；本轮不能等同完整原生迁移、正式视觉、
多模态模型协作或 LF-1b/M3 已完成。施工范围见 [组合同](native-world-group-plan.md)。

## 行为依据与裁决

直接阅读 apps/web 的 `PersonalMeaningComposer.tsx`、`personalMeaningJourney/mediaStore.ts`、
`semanticAgent.ts`、`gateway.ts`、`projection.ts` 与 `SensaSemanticWorldScreen.tsx`：
有序文字/图片、熟悉表达、三种可选对话起点、本机草稿；确认已有意思、补充表达、显式入学；
列表、展开、图谱和来源回看。代码是 Sensa 自己的 Rust/Dart 实现。

旧 Web gateway 提前创建不完整 Personal Meaning 的命名不覆盖领域模型：只有上下文、Sense、
Expression 全部明确确认才生成 personal_meanings / Alignment。Focus 始终可选。纯音频在旧 Web
仍是拒绝/未交付项，不能冒充本轮既有能力迁移；模型理解图片的请求链在第 4 组明确保留。

## 已接入

- 入口：我的词义世界 →「图文与语义关系」。保留既有英文捕获/在线澄清入口。原生是功能完整性
  验收界面，正式 IA/视觉仍由第 6 组统筹。
- 有序图文：添加、上移、删除文字/图片块；熟悉表达与起点可选；450 ms 防抖本机保存、退出/进入
  后台尝试保存，明确区分尚未保存、保存中、已保存和失败。失败不报告成功；表达确认失败保留表单。
- 草稿状态 editing/inbox/accepted/removed；已确认材料原版本冻结，复制编辑形成新的 Context；
  同一个已确认 Context 可继续选择其他已知 Sense/Binding。材料入口移除不删除已接受语义连接。
- 已接受 Sense 可补充表达。表达类型、关系 realizes/approximates/evokes、范围
  exact/broader/narrower/overlapping 都经本机校验；关系/范围必须本人选择。保留 Sense 版本，
  新 Binding/Acceptance 不覆盖旧连接/学习材料。重复绑定和重复上下文连接不会增生身份。
- 列表、展开与可平移缩放图谱共用已接受读模型。图只画实际 Context→Sense→Expression，按上下文
  分区并可点击详情；搜索意思/表达/上下文；来源、版本、可选关注点、同上下文分支、移除/恢复。
- 显式入学复用既有 personal/provisioning。旧材料使用已有材料；新表达进入独立需求与准备任务，
  不沿用旧表达的材料就绪状态。入学不会调用模型，更不会完成学习。近似/联想/非 exact 连接可保存，
  当前资源合同不能正确教学时明确关闭此入口，后续资源表达能力由第 4 组承接。

## 数据和执行边界

`world.rs`/`world.sql` 是本机个人内容接缝。schema 14 仅新增草稿、内容寻址图片、表达绑定表。
图片字节存同库 SQLite BLOB；限定真实可解码 PNG/JPEG/WebP、4 MiB、4096×4096、64 MiB 解码预算；
SHA-256 校验读取，缺失/损坏保留引用并显示不可用，不访问远端补图。其他库不能借同一摘要读取图片。
最多 30 材料块、256 KiB 草稿 JSON 与 500 草稿/个人意义；目前没有媒体清理/配额设置 UI。

World mutation 在正式 Activity 刷新、每日推进、时钟结算之前分流，共用库身份、CAS、operation receipt
与 SQLite 事务。图文编辑/接受/补充表达不写进度、证据、日程、签到或正式 Run。显式移除 Meaning
复用已有 membership/Anchor revoke 规则；如有授权，撤销本身仍是必要事实，不能笼统保证移除无副作用。
Free Practice 固定快照保留 worldContext / binding metadata / locator，保留来源，不能写正式学习结果。

原始图文与英语 Expression 分开：图文快照 language 为 und，不伪装英语 Capture；确认引用整个
上下文，不捏造文字选区。图片不默认发给任何 provider。旧 Anchor Use 的英文原文授权对图文关闭，
通用准备继续只用已确认词义和表达。旧紧凑学习包不含完整 semanticSpec，不据其摘要编造新的绑定定义。

## 验收证据

- Rust `tests/world.rs`：图文持久化、缺失/跨库图片、空上下文拒绝、同 Context 多 Sense、可选 Focus、
  冻结/复制、CAS、回执重放、跨库 command、恢复；有进行中的正式 Activity 时对学习表逐表比对不变；
  新 Binding 身份/幂等、原目标不变、unsupported relation 入学拒绝、exact 显式准备；schema 13 升级。
- `integration_test/world_test.dart`：真实 FFI/SQLite/解码/Flutter UI，中文文字＋图片、顺序编辑、草稿
  退出恢复、同上下文两义、图谱点开、表达关系确认与失败保留、移除恢复、显式进入 pending 准备，
  独立进程重开对比资料读模型与图片。仅 OS 文件选择替换为固定 PNG 输入，不把它算作文件选择器走查。
- 根级 typecheck/build/lint；Rust workspace all-features tests、Clippy all-targets/all-features -D warnings；
  bridge `cargo check --locked`；Flutter analyze；TS demand/assembler↔Rust provisioning 无成本回归。
- 最终运行标识 `world-0909-d`：macOS 主流程 2:52、独立进程恢复 0:25；Android 主流程 2:53、
  飞行模式独立进程恢复 0:27，全部通过。冷恢复先逐字段比对保存的读模型，再继续编辑草稿并证明
  已确认连接不变；准备任务保持 pending / attemptCount=0，没有调用服务。macOS 测试期间不可
  临时打开外部 accessibility 检查（会改变 Flutter SemanticsHandle 测试基线）；早期一次因此在
  流程完成后的测试清理断言失败，最终独立 bundle 的两次验收均通过。

复现：在 apps/sensa_native 运行 `flutter test integration_test/world_test.dart -d <device>
--dart-define=SENSA_NATIVE_RUN=<unique>`；Android 加 `--no-uninstall`。主流程成功后以同一 run
加 `--dart-define=SENSA_NATIVE_RECOVERY=true` 重开；冷恢复会继续修改合成草稿，不重复运行同一
recovery 断言。macOS 测试临时在 AppInfo.xcconfig 设置 Debug 条件 bundle id，不能只改项目层
Debug.xcconfig（会被 Runner 的 AppInfo 设置覆盖）；交付树不保留这个 override。

## 后续

第 3 组的本机图文/草稿/表达连接/投影已具备实施与验收链；多模态模型解析、provider 配置、完整资源
任务协作明确在第 4 组；采集 transport 在第 5 组；正式全站 UI/体验在第 6 组。旧 Web 本地化与
真实三端共同事实/E2EE 同步按 ADR 0003 继续，不能从本轮 schema 或单设备测试推断其已通过。

没有读取或迁移 owner 个人资料；测试使用合成命名库，Android 保留安装数据并保持飞行模式。
不推送、不部署、不调用付费 LLM/TTS；macOS 最终测试使用单独 Debug bundle，交付前恢复配置。
