# M2 原文使用授权与撤销

2026-09-08，本地纵切通过。沿用 owner 对私人原文授权/撤销的确认；由主代理直接实现。

Web 已确认意思旁默认不授权，显示发送内容、DeepSeek 生成与独立校验用途，显式点击才创建
`original-context-v1` grant。只发送该固定句子；来源 URL/title 和 Meaning Focus 不进入材料请求。
`personal.set_anchor_use` 走账号 outbox/Sync v3、Meaning revision CAS 和 operation replay。
未同步撤销明确显示尚未在服务端生效，并暂时禁用该意思的加入/准备按钮。

`0020_sensa_consumer_anchor_grants.sql` 保存不可改写的授权身份/原文版本/用途/接收方；撤销
不可反转。Meaning 保留当前 grant 引用。授权变化替换当前 immutable task，旧 task/attempt
保留为历史，Target 身份不变；新任务仍需显式准备。每任务 3 次尝试外增加账号滚动 24 小时
最多 30 次准备尝试，防止反复切换授权绕过预算。

生成中撤销会阻止下一次校验调用；校验已发出时撤销会阻止迟到结果冻结。撤销不可能撤回已经
发出的请求。移出个人内容同事务撤销 grant，恢复列表不会重授。任务只消费固定有 grant 的
personal_anchor；独立 reviewer 要求产物匿名化，不能把原文当作指令或公共语言学事实。

已开始的 Run 及其材料/回答/结算不改写；历史材料继续受账号授权保护。后续新首学、复习、
重学等待当前 plan 的新材料；复习/重学复制当前 ready plan 的材料，保留原 provisioning path，
不再无条件复制首次学习用过的材料。已开始的重学仍继续固定 Run。

验证：

- Node 完整 M1 A–E + M2 intake/semantic/provisioning smoke 通过。
- Deno M2 intake/semantic/provisioning 和 edge check 通过。
- 新故障向量：生成/校验中撤销、取消迟到结果、旧 grant 不可恢复、移除/恢复不重授、跨账号与
  旧 revision 拒绝、保留 active Run 结算、后续复习实际使用不同 digest 的通用材料。
- 实际 Chrome Web：默认关闭、显式授权、响应丢失/reload/replay、撤销、重授、移除自动撤销、
  恢复不重授。截图 `/tmp/sensa-m2-anchor-consent.png`、`/tmp/sensa-m2-restored-meaning.png`。
- `npm run typecheck`、`npm run build`、`npm run lint` 通过；构建保留既有 chunk size 提示。
- 全部本切片检查采用 no-cost fixture，无真实 LLM/TTS 调用。没有推送或部署。

完整账号删除及历史材料物理清理属于 M3 Data Control；本切片实现可恢复移除和未来使用限制，
不声称删除历史或撤回供应商已收到的数据。静态音频、扩展真实模型质量样本、前一 Chrome
主版本、商店热更新及托管验收继续按 M2 剩余范围推进。
