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
