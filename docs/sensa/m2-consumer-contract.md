# M2 消费合同与施工分段

> 2026-09-08；复用 M0-2 已确认体验。设计范围覆盖完整 M2；各段只有交付记录中的实测项算完成。

## 分段与依赖

1. M2-A：固定 Context/occurrence → local-first Intake → Postgres → 同账号 Web 收件箱；桌面 Chrome 实际采集、受控账号授权与原账号队列。
2. M2-B：受限 Semantic resolver、固定 Proposal/revision、直接 Acceptance 原子形成 Sense/Version/Binding/Meaning/Alignment；插件快轨和 Web 慢轨共用 authority，已确认与待处理分开。
3. M2-C：明确 personal-first Add-to-Learning，固定 Target/Policy/Demand；持久 Task/Attempt/Bundle、独立验证、冻结 Materialization、静态音频与 M1 Runtime 汇合。
4. M2-D：重启、切换/撤销、超时未知、更新、重复与迟到结果；有限真实 provider 质量/预算验证。商店提交及真实托管验收独立，不以本地 smoke 替代。

## 固定输入与保存

`CaptureSnapshot` 固定原文 sentence、language=en、source(url/title/capturedAt)、可空 expression(text/start/end)。span 为 Unicode code point 半开区间，必须精确等于原文片段；不做 Unicode/空白归一化。不完整材料允许无 expression；不能用其生成完整意义。

`intake.save` 是 Sync v3 operation，payload 只含 snapshot。沿用原 installation/replica、scopeEpoch、operationId、canonical digest 与结果账本。保存不要求每日学习数量，不创建 Sense、Curriculum、Run 或签到。相同账号、来源 URL（原样）、原文、language、同一 occurrence 去重；title/capturedAt 不参与产品身份，首次来源快照不改写。不同来源或不同 occurrence 分别保存。相同 operationId 不同载荷拒绝。

`IntakeView`：id/revision/status=inbox/snapshot/savedAt。bootstrap/pull 与 `GET /sensa/intakes/:id` 读取同一事实。未授权或其他账号按 not_found；深链只导航到既有引用，不能触发新保存。客户端先原子持久写入 outbox；pending/retained 分别呈现，未知结果重放原操作。输入超限明确拒绝，不截断。

## 扩展账号与权限

扩展独立 installation/replica。用户主动登录打开 Web 授权页，Web 使用既有受邀账号；授权请求固定 extension 回调、installation、随机 state 与 S256 challenge。Web 显式连接后得到短效一次性 code，仅向固定 chromiumapp.org 回调传 code/state；扩展以原 verifier 兑换专用凭据。URL 不包含原句或 access/refresh token，不读 Web localStorage。服务端仅存凭据 hash，绑定原账号、原 Session、epoch、安装及期限，撤销原 Session/邀请立即停止写入。重新授权不搬动另一账号 pending。

阅读模式限当前 tab；activeTab + scripting 读取用户选区所在句子，普通模式不读取。跨站保留意图但停止读取，工具栏再次主动授权；浏览器重启默认关闭。未保存预览不进持久库存。

## 后续命令边界

lookup 请求固定 snapshot/query identity，输出 candidate ID/revision、完整 Proposal、provenance 与期限；模型没有写 Acceptance 权限。accept operation 必须引用同账号、同 snapshot、固定 candidate/revision，并由已认证第一方明确接受动作产生。过期或修订冲突保留原输入，不自动套用新解释。Context/anchors 与公开语义分层；事务保存 acceptance、稳定语义和完整 alignment 后才返回已加入 Sensa。

独立 personal.add_to_learning 引用已接受 Alignment revision 与显式 anchor-use 选择，汇入现有 Target 去重。删除个人材料不删学习历史。Content Task 固定 Target/Demand/purpose，Attempt 受预算/超时/lease 限制；取消/过期 attempt 的迟到 bundle 不冻结。模型只产出候选，独立 validator 接纳后固定 digest。必需角色失败 blocked/preparing，可选音频失败显式缺省；重试不换 Target/Policy。

后续各段在实现前细化可执行 schema 和事务验收向量，不将本节设计当作已交付。

## M2-B 可执行确认合同（2026-09-08）

`POST /sensa/semantic/lookups` 固定 id/snapshot；同 id 原载荷可查询但不重新调用模型，
修改载荷拒绝。`GET .../:id` 检查原结果；单账号滚动 24 小时最多 30 次新 lookup，
provider 单次 35 秒，45 秒后迟到结果不进入 ready，服务重启遗留 running 读时转 timeout。
候选有 24 小时接受期限；未保存的过期预览在该账号后续 lookup 访问时清除全文/候选，
保留 id/digest 以拒绝复活原请求。它不是 Inbox 或个人意义库存。

`semantic.accept` 是 Sync v3 操作，引用 lookupId/revision=1/intakeId? 与明确的
`accept_context_expression_sense` command intent。只有同账号、ready、完整 occurrence、
未过期候选可新接受。事务创建 stable semantic registry、Context/Expression Anchor identities、
Meaning/Alignment/Acceptance，记录原 Session/installation/operation。Anchor 输入与完整
Proposal 保留在私人 Meaning，公共 Sense 只含抽象 semantic spec 和 generator digest。
完全相同 semantic spec + typed expression 复用稳定 registry；不是按词形或中文标签合并意思。
含歧义、schema 不合法、模型失败都保留材料而不建立 membership。

`personal_meaning` feed 与 bootstrap，intake.status 从 inbox 变 confirmed 并引用 meaningId；
Web 待处理与已确认分开，深链只读取对应账号投影。Acceptance 不创建 Curriculum/Runtime。
真实 DeepSeek adapter 必须显式配置 `SENSA_SEMANTIC_PROVIDER=deepseek`，只在服务端读取
DEEPSEEK_API_KEY；常规 smoke 注入确定性 adapter。模型不得访问 SQL、接受或学习操作。

## M2-C 入学与内容准备施工合同

`personal.add_to_learning` 显式引用 Meaning/Alignment revision 与当前 Curriculum scope revision，
默认不授权原网页 Anchor 用于生成；未授权路径只使用已接受的抽象 Sense 与 target expression。
正式目标输入由 `target_candidates` 统一保存并按 learner 隔离，公开 catalog 为过滤视图；
不能把私人 Meaning 作为公开 catalog 条目。入口复用 Target 去重及 M1 Runtime，不把 learner-confirmed 冒充 reviewed。

加入只建目标、preparing plan 和 durable provisioning task；线上 prepare 命令逐任务领取 attempt，
网络调用不占 DB 事务。任务固定 Target/Policy/Protocol/完整 Demand/两类 authoritative artifacts。
Content generator 只提交 cue candidate；target/meaning 由 authoritative passthrough 提供。
独立 validator 验证固定语义一致性、语言、scene 质量与 reveal 前泄漏，再经 schema/角色/来源验证冻结。
缺可选音频不伪造 URL，必需内容未就绪不允许开始 Runtime。

每账号滚动 24 小时最多 30 次准备尝试，每 task 最多 3 次显式尝试，每 attempt 最多一次生成和一次独立校验，无开放工具。
生成结果先持久提交 bundle 再进入校验；lease 过期保留未知/失败原因，不自动重复计费。
重启后 ready 保持；pending 可领取，未过期进行中不重复调用，过期须明确重试。
取消阻止迟到结果冻结；原 Target 和历史不删除。epoch/账号撤销在各阶段重新检查。

## Web 澄清与个人列表恢复

Lookup 可显式引用 previousLookupId 和 learner 自写关注点，生成新的固定候选；旧候选失效，
原文/occurrence 不变。Focus/Construction identity 留在私有链，接受时保留引用。刷新通过 Intake
查询最新未取代的 lookup；模型失败后重试必须由用户触发。
`content.set_membership` 按 entity/id/revision 控制可恢复移除/恢复，走同一 local-first 账本。
移除不删除学习目标或历史；旧保存/接受不得复活移除的个人列表状态。永久删除另走数据控制。

## 原文使用授权与撤销

`personal.set_anchor_use` 固定 Meaning expectedRevision、enabled 和 `original-context-v1`，
显式允许把该固定句子发给 DeepSeek 生成/独立校验；不包含来源 URL/title 或私人 Focus。
Meaning projection 的 nullable `anchorUseGrantId` 是服务端当前许可。未同步撤销尚未生效。
授权改变时保留旧 task，创建新的当前 task；原文 artifact 必须带 grant ID 与原文版本 digest。
撤销/移出个人内容阻止后续调用和迟到冻结；恢复列表不恢复 grant。已开始的 Run 与历史保持
不可变，新学习/复习/重学只使用当前 ready plan 的材料。详见[交付记录](m2-anchor-use-handoff.md)。

## 按需材料静态发音

准备任务按 exact accepted expression 的文本 digest 解析受控静态发音，固定 reference fact，
pronunciation candidate 引用 target_expression candidate，确定性 validator 检查该绑定。
缺失/不可下载音频保留文字学习；Web 不因可选媒体失败丢弃已验证文本缓存。回想不展示发音，
揭示可播放已下载的音频。生成候选显式 opt-in，发布仍走 CI/CD，见[记录](m2-pronunciation-handoff.md)。
