# 原生原文授权、撤销与材料替换交付

2026-09-09。范围与已确认体验见 [施工蓝图](native-anchor-use-plan.md) 和 [Web 原始交付](m2-anchor-use-handoff.md)。本轮承接个人意义按需文本路径，不宣称完整同步或迁移完成。

## 实现

Flutter 在个人意义的准备页面默认显示原文未授权。明确授权前展示固定原文、接收服务、DeepSeek 生成和独立复核用途，说明撤销不能收回已发送内容。来源 URL/title、Focus 和 occurrence explanation 不进入内容请求。私人提示可以保留真实人名与事件；既有 TS generator/reviewer 对 private anchor 的忠实转述规则继续使用，没有复制/翻译 Read Frog 源码。

Rust schema v11 增加不可变 grant、独立 revocation 和固定 preparation version。Grant 固定 Context 身份/摘要、原文、用途、接收方与授权操作；撤销永久保留，重授产生新 grant，移除个人意义同事务撤销，恢复不重授。接收服务不匹配时无法开始携带原文的请求。

当前准备行是逻辑目标的工作投影，planRevision 同时标识本轮固定准备版本；不可变来源/授权/Policy 快照存入 personal_preparation_versions。尝试固定相应版本和请求摘要。授权变化关闭旧尝试、创建新准备版本，保留目标身份、旧材料与尝试结果；每版本三次机会，本机/服务账户滚动 24 小时 30 次跨版本限制继续生效。版本存储不是已完成的跨设备事实导入协议。

目标的当前材料引用可在新材料接纳后切换。旧 Run、其材料/Policy pin、回答、Completion、Memory Outcome 和首次 Handoff 不改写。新首学/Review/Relearning 等待当前材料；已经开始的 Run（包括等待中的重学）继续固定材料。Profile commitment 保留原学习方式，新材料计划不允许借机更改已承诺 Profile。目录按目标显示完成状态，历史 on-demand 材料保留供 Run 审计，不能作为独立新目标再次选择。

多段经历可以关联同一目标。明确采用另一授权来源时，准备版本记录其 meaning/grant；准备页显示实际使用的原文，从准备列表进入优先定位当前来源。撤销未被采用的另一 grant 不取消当前来源。

Hono 新增 `/sensa/native/content/cancel`，迁移 0024 只记录 account/request id、digest 和取消时间。请求去重，生成前、独立复核前及返回前检查权限与取消状态。Flutter 先提交本地撤销，再尽力通知原服务；本地已有更可靠的旧尝试/版本/授权校验，因此网络失败或进程中断不使旧结果再次合法。

离线撤销无法阻止尚未收到通知的服务继续处理已收到内容；取消通知不承诺跨重启后台补发。界面说明本地已拒绝旧结果和在线通知失败，不声称抹除供应商数据。新 Provider 管理/密钥安全存储及分布式授权撤销仍为后续用例。

## 验证

全部使用合成资料与 no-cost generator/reviewer；没有付费 LLM/TTS、用户库迁移、云端部署或推送。

- `sensaNativeAnchorSmoke.mts`：真实 Hono/TS assembler → Rust driver/SQLite；固定原文和来源匹配、接收方拒绝、授权命令重放/CAS、生成前后两种撤销竞态、迟到结果拒绝、不可逆撤销/重授、移除恢复、共享目标来源选择通过。
- 同一脚本验证：已开始初学固定私人材料，目标换成通用材料后旧 Run 仍正常完成；未来 Review 实际读取新 digest，发生遗忘后 Relearning 固定再次替换的材料；准备中不能新开重学或更改已承诺 Profile；旧材料/Run 仍保留，只有一份 memory 和首次 Handoff。仅使用隔离 driver 时钟推进到期，无修改设备时间。
- `sensaNativeProvisioningDatabaseSmoke.mts`：真实隔离 Postgres `sensa_native_provisioning_20260909` 应用 0024，验证取消先于 dispatch、先于 reviewer、reviewer 已在途三个时机，重复取消与 digest 冲突；原有并发去重、每日预算、跨日及访问撤权回归通过。usage/cancellation 均仅四列元数据，服务器个人任务无新增内容。
- 原有 `sensaNativeProvisioningSmoke.mts` 通用文本链路回归通过；Rust library 全部集成测试、v10→v11 空库与已有真实准备任务升级（固定版本、快照及原命令回执保持一致）和旧版升级回归、workspace clippy、bridge locked check、根级 typecheck/build/lint 通过。Flutter analyze 无问题。
- Android `android-anchor-02` 主流程与独立进程冷恢复通过：授权/准备/首学、撤销后通用替换、生成中撤销；快照重启一致，无服务凭据时仍可撤销已保存的授权。通过 adb 回环 4325 访问本机 fixture，不调用真实模型。
- macOS `mac-anchor-03` 主流程通过。初次同 bundle 验收实例发生等待，未计通过；后续以临时 Debug bundle `app.sensa.sensaNative.anchorAcceptance` 隔离验收，工程配置在测试后恢复。
- macOS `mac-anchor-03` 冷恢复通过：完整快照一致、无在线凭据离线撤销通过；`personal_world_test.dart` 的 `mac-anchor-regression-01` 原有本机材料接受/移除恢复/入学回归通过。临时 Debug bundle 配置已恢复，未改动正式应用标识。

复现主流程：先运行 `node --import tsx scripts/sensaNativeAnchorSmoke.mts --serve-only`（回环 4325），再在 apps/sensa_native 用 `flutter test integration_test/anchor_use_test.dart -d <macos|emulator-5554> --no-uninstall --dart-define=SENSA_NATIVE_RUN=<独立名称>`；同名加 `--dart-define=SENSA_NATIVE_RECOVERY=true` 验证冷恢复。只用独立测试库，Android 需 adb 回环转发。

## 边界与下一项

本轮是有在线构造 Sense 的个人意义按需文本路径。已有本机发布材料的直接入学保持原路径，本轮不为它伪造可供在线生成的 Sense Proposal。原生完整 Source/Scope 扩展、同步导入/合并、原生完整 IA、账号/Provider 管理、历史物理删除等均未完成。真实模型对私人经历的忠实性仍需独立质量验收；本轮替身不证明真实模型质量。

下一纵切：静态发音/音频资源获取、离线播放与失败回退，复用已存在的 Web/TS 能力及原生媒体基础。正式 Hono 服务启用本次能力前需由 CI/CD 应用 0024。
