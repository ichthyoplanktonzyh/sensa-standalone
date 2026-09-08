# M2-A：采集到收件箱本地交付

> 2026-09-08；原工作树主代理直接实现，无委派、推送或部署。

## 结果

Chrome 扩展主动划选文本，固定所在句子、Unicode code point occurrence 与 HTTP(S) 来源，
原位保存待处理。专用安装先持久保存，再上传 Sync v3；图标检查结果，打开同账号 Web 原记录。
Web 收件箱也可手动保存原文/定位表达，保存与查看不以每日学习数量为前提。
采集不会创建 Sense、Curriculum、Run、签到或学习进度。

实现包含 consumer intake schema、0016 Postgres 迁移、private Intake authority、bootstrap/feed、
Web IndexedDB/outbox 和实际 MV3 扩展。保存去重固定来源 URL/句子/occurrence，首次 provenance
不改写；错误 span 拒绝。模型解释尚未接入，界面如实显示；M2-B 继续原位确认与 Web 慢轨。

插件由 Web 显式授权，真实 launchWebAuthFlow 回跳 code/state，S256 verifier 一次兑换。
专用凭据绑定账号、原 Session、epoch、安装及 7 天期限；服务器只存 hash。
原 Session/邀请撤销停止提交；安装约束覆盖初始化/bootstrap/push/pull。重新连接原账号
保留安装、原操作、原 epoch 和队列；不同账号队列分区。未保存预览不进持久库存。

## 本地证据

- 全新隔离 PostgreSQL `sensa_m1a_m2_final` 以每迁移事务方式应用 0001–0016，确定性 fixture。
  初次尝试的空测试库 `sensa_m1a_m2_a` 因迁移需要事务未完成，未用于验收；未动用户数据库。
- Node 完整 A–E 加 `--intake`：Unicode/多 occurrence、去重/来源不覆盖、原操作重放、
  ledger 故障全部回滚、账号隔离、无 plan 采集、错误 PKCE、单次 code、安装隔离、撤销。
- Deno 执行 intake + 基础回归；Edge check。
- 真实扩展 browser smoke：launchWebAuthFlow、合成邮箱登录、Web 连接确认、PKCE 兑换、
  content script 原位选择含 emoji 原句、closed-shadow 浮层、持久队列、服务器保存、
  同账号深链；另一 occurrence 离线保存后重启浏览器、恢复上传；重启不恢复阅读模式。
- 浏览器 Chrome for Testing 149.0.7827.55，macOS arm64，1280×800；截图
  `/tmp/sensa-m2-capture.png`、`/tmp/sensa-m2-inbox.png` 已视觉检查。
- M1 A–E production Chromium 全流程回归通过，包含离线回答、丢响应、复习重学与账号切换。
- 根级 typecheck、配置合成认证的 production build、lint。

## 仍待验收

自动扩展测试仅向本地 fixture 添加 host permission，真实 activeTab 工具栏授权、跨站恢复、
前一 Chrome 主版本、更新/撤销故障矩阵仍待 M2-D；不能以该测试宣称权限与兼容矩阵通过。
真实 Supabase/邮件/Storage、商店分发与远程 CI 未验收。常规检查无模型/TTS 调用。

首条采集/持久/同账号读取切片已具本地证据；整个 M2 尚未完成。
B 语义确认、C 持久内容供给与入学、D 完整恢复按 [M2 合同](m2-consumer-contract.md) 继续。
既有 500 项 bootstrap 限制延伸到 Intake，超限明确拒绝；大库存分页待后续。
CSS gzip 119.68 kB，仍超初始预算；应用壳离线冷启动和公网性能缺口继续保留。
