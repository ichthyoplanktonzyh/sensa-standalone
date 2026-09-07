# M1-A：登录、数量与空首页交付记录

> 日期：2026-09-07；状态：本地纵切已验证，托管环境验收未完成。
> 确认依据：[M0-2 首条旅程](m0-2-first-learning-state-spec.md)、[M0-3 消费合同](m0-3-consumer-contract.md)。

Owner 已授权继续 M1、浏览器测试，并要求之后由主代理直接实现，不使用 worker。
工作位于原树 `/Users/shadow/sensa-standalone`。开工前 checkpoint 为 `7d309f9d`；
本记录对应的 M1-A 修改由 owner 授权提交为 checkpoint；未推送或部署。

## 本次接通

受邀邮箱验证码登录后，必须明确确认每日新学数量，再进入没有学习目标的首页。
数量可修改；先在账号独立的 IndexedDB outbox 保存，再 push → pull。
刷新、网络中断和服务端已提交但响应丢失时保留原操作，按原 operationId 安全重试。
冲突保留原选择供查看，不把拒绝显示为保存成功。待同步设置先同步，再退出登录；
会话撤销可重复，撤销后业务请求拒绝访问。正式入口暂只显示首页与设置。

实现位置：

- `packages/contracts/src/sensa/consumer/account.ts`：账号/数量 JSON schema、版本和规范序列化。
- `apps/api/src/sensa/access/`：JWT 校验、邀请/会话/安装隔离、数量 CAS、操作结果账本和变更流。
- `db/migrations/0011_sensa_consumer_account_v3.sql`：独立 server-only schema；绑定既有 Account/Learner。
- `apps/web/src/application/`、`apps/web/src/data/`：正式入口、Supabase Auth、账号本地副本和恢复。
- `supabase/functions/sensa-api/`：同一编译产物的 Deno Edge 入口；无本地认证回退。
- `.github/workflows/sensa-consumer-check.yml`：构建、迁移、受限测试身份、Node/Deno 集成检查。

`VITE_SENSA_MODE=preview` 明确选择既有原型，其他值进入正式账号路径。当前开发者本机的
ignored Web `.env` 保留 preview 模式；正式模式缺少服务配置时显示暂不可用。
正式构建跳过旧原型媒体拷贝，不调用内容生成/TTS。

## 合同边界

本次实现 M1-A 的 `plan.confirm_quantity`、`plan.set_quantity`，以及账号会话、
bootstrap/push/pull、操作查询与空首页。未实现的操作返回 `unsupported_operation`。
M0-3 仍是完整 M1 目标合同，不以这个子集宣称完整 Sync v3 已交付。

当前 bootstrap 是单个 Plan 的有界快照，尚无后续 Target/Run 多实体分页；push 返回逐操作结果，
尚未提供完整 M1 的投影收敛元数据。首页目标/Run 计数为零，因为该新命名空间尚无相关写入口；
`newStartedToday=0` 只在此切片有效。后续 Run 切片必须接入真实计数、开始配额和账号日期投影，
不能把“数量已保存”当成“当日学习配额行为已验收”。跨日时已有 Plan 变更流快照的日期不是
最新日期，首页读取当前日期；跨日学习行为还须随 Run 一起验收。

旧 Node API 的兼容认证/Sync 仍保留；正式 consumer 路由自行校验 Supabase JWT，不使用旧身份。
Edge 仅挂载新 consumer 路由。旧学习事实不静默映射到新计划，不改写旧 Sync v1/v2。

## 已有验证

- 全部 11 个 SQL migration 在新建的隔离 PostgreSQL 数据库逐文件事务应用成功。
- 使用仅继承 backend_app 的测试身份运行 Node 与 Deno 集成：签名/受邀限制、并发初始化、
  数量幂等重放、operationId 重用拒绝、并发版本冲突、账本故障导致整条事务回滚、
  分页、账号/安装/replica 隔离、epoch、依赖循环、空 batch 授权、会话重复撤销。
- Chromium 390×844 与 1280×800：错误/正确验证码、首次明确数量、刷新、离线保存及重连、
  API 断网后刷新保留 outbox、已接受响应丢失后重放、退出登录；检查无页面异常。
- 根级 `npm run typecheck`、`VITE_SENSA_MODE=production npm run build`、`npm run lint`。
  lint 当前仍复用类型检查，未宣称额外规则扫描。
- `npm run sensa:edge-check` 检查 Edge 编译入口；Node/Deno 运行同一 PostgreSQL/JWT 场景。

浏览器登录使用**独立测试脚本中的合成 Auth API**和临时 ES256 密钥，业务持久化是真实本地
PostgreSQL。没有验证真实邮件发送、Supabase 托管 JWT 配置、托管连接池或公网 Edge。
测试不读取用户学习库，不调用付费模型。截图保存在 `/tmp/sensa-m1a-browser/`，为临时本机证据。

## 复现入口

先安装依赖、编译仓库，准备只用于本用例的 loopback PostgreSQL 数据库，名称以
`sensa_m1a_` 开头，按顺序应用 migrations。测试登录角色继承 `backend_app`，仅另加
`invitations` 的 INSERT/UPDATE 供夹具创建，实际服务身份不得拥有此额外授权。
连接串通过 `SENSA_TEST_DATABASE_URL` 注入，不提交真实密钥。

```sh
npm run sensa:consumer-account-smoke
npm run sensa:edge-check
node --import tsx scripts/sensaConsumerAccountSmoke.mts --serve
```

最后一条启动 127.0.0.1:4319 的临时夹具。另一终端以
`VITE_SENSA_MODE=production`、`VITE_SUPABASE_URL=http://127.0.0.1:4319`、
`VITE_SUPABASE_PUBLISHABLE_KEY=local-browser-test-key`、
`VITE_SENSA_API_URL=http://127.0.0.1:4319` 启动 Web 在 3001，随后执行
`npm run sensa:consumer-browser-smoke`。可以通过 `SENSA_CHROMIUM_PATH` 指定已安装的
Playwright Chromium；否则先安装 Playwright Chromium。该夹具只提供测试邮箱与固定验证码，
不得用于公网或真实用户环境。

## 仍待完成

1. Supabase 项目、真实受邀 Auth 用户与服务端邀请条目、非对称签名、SMTP/Resend 配置。
   Web 仅使用 publishable key；服务器凭据交给 CI secrets，不发到聊天或浏览器。
2. 通过 CI 验证托管 Edge JWT、数据库 TLS/连接池、权限与生产冷启动，并检查真实验证码投递。
   已写 CI 检查文件，但尚未在远端执行；没有部署流水线或上线结果。
3. 首包 CSS gzip 119.66 KiB，高于 M0-3 初始 100 KiB 预算，来自共用样式。正式入口 JS
   gzip 123.72 KiB、账号异步块 40.74 KiB；仍需托管环境弱网测量，不能宣称性能门通过。
   web-next 既有大块构建警告仍在，未把原型优化扩为本次范围。
4. M1-B 目标选择/准备、M1-C 正式首学、M1-D 复习/重学、M1-E 签到尚未实施。
   下一步按已确认体验继续 M1-B，同时补齐托管环境前置，整个 M1 尚未验收。
