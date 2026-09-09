# 原生资源大组收口

2026-09-09。Owner 授权整组连续推进；沿用已确认 Web 准备、授权、参考资料与揭示行为。

## 用例与边界

1. 准备页允许用户导入有来源、edition、license、attribution、reviewer 和摘要的参考摘录，明确
   对齐当前固定 Sense/Binding。可移除/替换；来源同版不可变；正在生成的旧结果失效，旧 Run 不改。
   这是用户选择信任的本地参考资料，不冒充平台认证或在线词典。保持既有 Web source-backed
   language_structure / usage_example / pronunciation 音标 和教学候选的区别，模型不能编造参考事实。
2. World 图文上下文提供与 Capture 一致的原文授权，展示发送内容和接收服务。只发固定 blocks，
   不发送其他世界记录或采集元数据；生成与独立复核使用相同授权原文。图片需双方 vision 能力，
   本机校验字节且有大小上限；撤销/换源阻断迟到结果。
3. 固定 Binding relation/semanticCoverage 随 Task/Attempt 进入生成和审核；非完全实现的表达必须
   在揭示后说明实际适用关系。无法形成忠实材料时审核拒绝，不能冒充等价翻译或改写 Sense。
4. 资源准备反馈、失败重试和源资料检查纳入原生 UI。上游 TS/Python authoring/review/publication
   保留并执行无成本 validator 验证。账户属于可选在线服务访问，不能成为本机资源/学习前置条件；
   云端账户生产化与同步仍服从 M3/发布门。

## 验收

Rust 真实事务验证固定输入、摘要/同版冲突、参考撤回、关系准入、图文授权及生成/审核双侧限制，
并与既有 TS schema/assembler 验证保持兼容。macOS/Android 使用独立合成库和本机 HTTP fixture，
检查准备→独立审核→材料→揭示/学习→冷恢复。常规测试不调用付费服务，不读取 owner Key/资料。

盘点中另补两项收口：兼容模型接口的有界 SSE 文字预览（完整响应后才执行工具）；Sensa 静态
发音目录接入统一 Agent 请求，先固定来源/表达摘要，提交后尝试缓存。参考生产工具提供
`compileNativeReferenceExcerpt.mts`，使用现有 Web reference-fact schema，不要求用户手写摘要。

账户仍计入本组：沿用 Web `SensaApp.tsx` 的受邀邮箱 OTP，接入系统安全存储、提前续期、
单次并发刷新、冷恢复和本机退出。Hono 新增最小 native access session，沿用既有 invitation /
account/session 授权，不初始化 replica、plan 或读取/上传学习资料。认证不建立同步账户与本地
Learner 的映射；这仍由未来同步合同裁决。真实 Supabase 邀请/邮件、供应商配置和托管访问属于
既有生产部署门，本轮只用合成 Auth HTTP 与隔离 Postgres 验证。
