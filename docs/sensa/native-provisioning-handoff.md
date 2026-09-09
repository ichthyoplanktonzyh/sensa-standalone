# 原生个人意义入学与按需材料交付

2026-09-09。范围沿用已确认 Web 的显式入学、准备、取消、重试与学习体验；实现依据是既有 `provisioning/tasks.ts`、`material.ts`、内容合同及 M2-C。见 [本轮蓝图](native-provisioning-plan.md)。本条用例完成不代表完整迁移、LF-1b 或 M3 已完成。

## 实现与所有权

个人意义接受后，用户明确选择学习方式、加入学习。Rust schema v10 在材料存在之前保存固定语义目标、目标级 Policy Assignment、成员关联与准备任务；语义世界移除不会删除独立学习意图。同一 Sense Version/Binding Version 复用目标、预算和材料；冲突的学习方式不能被默默覆盖。

当前复用的 TS 在线供给能力是 lightweight/v1 文本需求。其他已注册 Profile 保留阻塞状态，不自动降级。准备未就绪时允许用户明确改选 Profile，但不重置尝试次数。就绪后接入现有 Policy Plan、Activity、Protocol 与调度；没有另建学习队列，也没有让生成服务写学习完成或进度。

本地准备先固定请求，再调用 Hono `/sensa/native/content/prepare`。Hono 复用 `makeRequest`、生成、独立复核和 `validateBundle`，返回带输入摘要、来源、候选、校验及材料摘要的结果。Rust 再校验精确 Demand、目标/计划版本、权威输入、角色覆盖、来源、独立验证与中文提示的表达隐藏要求，然后原子冻结材料、建立执行投影与入学。正式学习前的 scene/sense 使用已复核中文 cue，避免把英文表达或语义解释提前展示为提示。

准备请求只发送已确认的可复用语义规格和目标表达，不发送个人 Context、Focus、来源 URL 或该次经历的 explanation；后者仍留在本地意义记录。原文授权不是默认开启的功能。本轮不生成音频。

每个目标最多三次尝试，本机及服务账户各有滚动 24 小时 30 次预算。尝试、固定输入和终止记录持久保存；取消、改选方式、超时和旧响应无法使材料就绪。进程重启保留中断任务，由用户取消或在有效期结束后明确重试，不自动调用模型。服务地址/访问令牌沿用在线语义设置，只保存在当前会话。生成后的材料和正式学习可离线使用。

迁移 `0023` 的服务器表仅保存账户、请求 id、摘要与时间。账户事务锁保证重复并发请求不会重复消费模型；调用完成后再次检查访问权限。个人任务、输入与材料不落服务器业务表。现有 Web 路径保留。

## 验收证据

全部使用合成材料与无成本生成/复核替身；未调用付费 LLM/TTS、迁移 Owner 数据、推送或部署。

- `node --import tsx scripts/sensaNativeProvisioningSmoke.mts`：真实 TS Demand/生成装配/独立复核 → Rust CLI/SQLite 接纳；覆盖请求与来源篡改、拒绝、命令重放、同目标去重、方式冲突、三次预算、取消后的迟到响应、移除个人意义后任务独立保留、不支持 Profile 阻塞及明确改选。验证私人 Context 和 explanation 不进入内容请求。
- `scripts/sensaNativeProvisioningDatabaseSmoke.mts`：真实隔离 Postgres `sensa_native_provisioning_20260909`，仅复制测试 schema 并应用 0023；并发去重、30 次预算/跨日、调用中撤权通过，服务器个人内容/任务表没有新增行。
- macOS `mac-provision-02` 与 Android `android-provision-02`：Flutter → 本机无成本 Hono → Rust/SQLite，显式入学、准备就绪、进入既有轻量执行器、首学完成与一次调度交接通过。独立复核拒绝三次后阻塞，取消后迟到结果不接纳。
- 两个平台分别独立进程冷启动，完整快照与退出前 receipt 一致；清空在线凭据后，已完成学习记录保留，中断任务可离线取消。Android 开启飞行模式、关闭 Wi-Fi，仅通过 adb 回环访问本机测试服务。
- `personal_world_test.dart` macOS `mac-provision-regression-01` 验证原有本机材料接受、移除恢复与显式入学，避免新路径破坏已有入口。
- Rust library 集成回归、schema v9→v10 及旧升级样本、workspace clippy、原生 bridge locked check 通过。根级 `npm run typecheck`、`npm run build`、`npm run lint` 通过；Flutter format/analyze 通过。

平台复现：在 `apps/sensa_native` 执行 `flutter test integration_test/provisioning_test.dart -d <macos|emulator-5554> --no-uninstall --dart-define=SENSA_NATIVE_RUN=<独立名称>`；同名追加 `--dart-define=SENSA_NATIVE_RECOVERY=true` 验证冷恢复。主流程需先启动 `node --import tsx scripts/sensaNativeProvisioningSmoke.mts --serve-only`；Android 需回环转发 4324。只使用独立测试库名。

## 尚未完成与下一项

下一纵切优先迁移已有 Web 的 Anchor Use：个人原文显式授权、撤销、迟到生成隔离及后续学习材料替换，保留旧 Run/材料/历史。这是本轮通用抽象输入之外的独立用例。静态发音生成/下载与失败回退随后承接。

完整资源发布治理、原生账户/Provider 管理、安全凭据保存、流式解释、多模态/草稿/图谱、浏览器/Agent 本地交接、完整原生 IA、备份与同步仍在清单。当前准备任务投影容量为 500，归档/分页仍需后续处理。真实模型质量、网络环境和托管服务尚未验收；正式服务启用前需通过 CI/CD 应用 0023。
