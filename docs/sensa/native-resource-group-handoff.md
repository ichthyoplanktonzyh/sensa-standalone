# 原生完整资源与在线协作大组

2026-09-09。接续可选文本资源与 Provider 交付，Owner 要求整组连续完成。
[施工范围](native-resource-group-plan.md)承接既有 Web 行为及原生迁移清单第 4 组。

## 原实现与本机合同

| 原实现/既有资源 | 本轮收口 |
| --- | --- |
| `lightweightLearningContent.ts` Reference Facts；Web `lightweightInitialContent.ts` authoritative producer | 有来源/版次/条目/授权/署名/审核记录的摘录编译和显式本机对齐；Rust 校验 payload、摘要与固定 Sense/Binding；同一来源版本不可改写 |
| Web `contentAgentProvisioning.ts` 固定 context artifacts、独立审核 | 原生 v3 Attempt 读取真实附加参考事实，模型只提教学候选；核心把通过复核的参考 payload 原样材料化，保留来源 proof 和缺失角色 |
| 既有 Anchor Use / World blocks | World 文字和图片可以显式授权；发送前展示原文与图片、接收方和撤销语义；生成、独立复核均受同一 recipient、vision 能力和版本约束 |
| World relation/semanticCoverage | 固定关系随 Task/Attempt 交给生成与复核；非完全实现/覆盖必须带揭示后的用法说明；不能假定等价翻译、改写 Sense 或合并 Binding 的学习目标 |
| 静态 pronunciation 目录与 native pronunciation cache | 新 Agent 主入口也能先查询配置的 Sensa 静态服务，只发送表达；固定 source-text digest、媒体元信息及 recipient，提交后尽力缓存；失败继续文字学习 |
| Provider 工具循环 | 兼容接口接入有界 SSE 文字预览；工具调用必须完整拼接、收到正常终止后才提交本机；截断/超限/异常结束拒绝；Sensa gateway 保留原有完整响应合同 |
| Web `SensaApp.tsx` 受邀邮箱 OTP 与 Auth 生命周期 | 原生可从 Sensa 服务菜单登录邮箱、重新检查访问、退出；系统安全存储保存 access/refresh，按用途在请求前续期，并发刷新串行化，登录不修改本机学习事实 |
| Hono Account/Invitation/Session | 最小 `/sensa/native/access/session` 初始化在线访问；不创建 replica、plan 或迁移数据；刷新后的服务授权失败可重试，已轮换的 refresh token 先安全持久化 |
| 上游 authoring/review/publication | 保留 TS/Python 校验和发布工具，不在 Flutter 建发布后台、不重写生成工具；本轮执行无成本源 pipeline 验证 |

## 可见行为与数据边界

准备页可导入参考 JSON 摘录，显示完整来源，明确确认当前表达/词义适用。摘录来自用户选择
信任的来源，不是平台认证，也不意味着已经提供覆盖所有词条的离线词典。缺失参考事实时
必需材料仍可生成；模型不能把自造的词性/例句标成来源事实。来源工具不会读取整个语义世界。

摘录生产方式：

```
node --import tsx scripts/compileNativeReferenceExcerpt.mts input.json output.json
```

输入包含 sourceId、edition、entryId、sourceUrl（无认证信息的 HTTPS 地址）、license、
attribution、reviewer、expression、expressionKind，以及共享 schema 的 language_structure /
usage_example / pronunciation facts（音标）；音频 URL 不直接准入，音频仍走固定摘要和缓存管线。输出摘要按递归排序的 JSON 计算，导入时由用户明确对齐本机目标。
同版冲突在移除、冷启动或换目标后仍拒绝；正确新版本/移除会固定新的准备版本，并阻断旧结果。
已开始 Run 使用其旧 Material，历史不重写。

图文授权只发送固定 blocks 和目标信息；不发送 World 中其他记录、来源网址/标题或 Focus。
图片固定 digest、media type、大小，传输前读取本机校验字节，保持 6 MiB 总量限制；不自动将原图
变成学习卡，也不把视觉模型的解释升级为权威事实。生成器和复核器必须都具备视觉能力并使用
已授权接收方；撤销后不接受旧任务回调，已经发送的内容无法收回。

新 Agent 使用 `native-agent-lightweight-v3`。既有 v1/v2 的提示/工具合同保留；没有新增来源的
旧 TS prepare wire 仍兼容。新的参考事实、关系说明、图文来源和静态发音均被固定在 input/proof，
不是 Flutter 直接写 Material 或学习结果。回忆 cue 与 recall_support 都使用 NFKC/大小写/空白归一
检查直接答案泄露；独立模型审核继续负责语义、忠实来源和适用关系的判断。

认证项目地址与公开访问密钥由服务提供方配置；目前原生登录页允许明确填写，与 Provider 配置
一同作为技术验收入口。access、refresh、邮箱与认证配置只进系统安全存储，公开配置仅有
随机引用；库路径/Provider 身份/服务地址固定凭据作用域。配置复制到另一库不能解锁会话。
失效 refresh 要求重登；网络故障保留可恢复凭据，不能默默切换服务。退出清除本机访问并尽力
撤销 Auth 会话，不清除本机资料、已缓存资源或学习进度；不会启用同步。

完整宽覆盖 Reference Release/词典、任意表达实时 TTS、四阶段正式 UI 与三端同步仍是后续
蓝图能力；真实 Supabase 邮件/邀请、部署和生产模型质量仍须发布门验收。本轮不调用付费
LLM/TTS，不声称真实模型语义质量或生产云服务已验收。

## 验收记录

- Rust workspace all-features、Clippy all-targets `-D warnings`、原生 bridge `--locked` 检查通过。
- 根级 `npm run typecheck`、`npm run build`、`npm run lint`，Flutter analyze 与 SSE 分片/截断测试通过。
- 共享 Web reference-fact schema → 摘录编译 → Rust 摘要/目标/来源准入跨语言检查通过；原 TS prepare wire、可选资源向量与静态发音回归通过。来源音标原样固定、揭晓后展示；不允许模型编造音标或直接嵌入远程音频 URL。
- macOS 与 Android 原生资源端到端：World 图文授权、非精确 Binding、来源摘录、流式生成/独立拒绝后修正、五份可选文本（含音标）及静态 MP3 缓存、进入 Run 后撤回原文/来源、保留旧材料完成一次学习、独立进程冷恢复。全部通过。
- macOS 与 Android 在线账户端到端：错误/正确 OTP、服务授权拒绝与恢复、并发单次刷新、轮换后授权失败仍保留新凭据、跨库凭据隔离、失效刷新清除、离线冷恢复和退出。全部通过；本机学习事实没有变化。
- 隔离 Postgres 验证 native access 不创建学习计划/同步安装；无邀请、撤销访问、首次转入 Web 时区初始化及既有资源配额/取消路径通过。没有使用 owner 数据库或真实邮件。
- 上游 Python 内容工具 compileall 与 `content/tools/smoke_pipeline.py` 无成本验证通过。未调用付费 LLM/TTS，也未推送或部署。

平台用例为 `integration_test/resource_group_test.dart` 与 `provider_account_test.dart`；同名
`SENSA_NATIVE_RUN` 主流程后以 `SENSA_NATIVE_RECOVERY=true` 独立启动冷恢复。Android 保持
飞行模式、关闭 Wi-Fi，以定向 adb reverse 访问本机合成服务，使用 `--no-uninstall`。
macOS 使用独立临时 Debug 签名身份以验收系统安全存储，签名配置不入库。owner 的 Release
应用保持运行。测试后撤销本组 adb 转发、结束 fixture、删除本组专用合成数据库/角色并恢复签名文件。
