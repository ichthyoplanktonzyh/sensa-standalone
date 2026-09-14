# Sensa Web 工程说明

本文是当前 Web 工程、验证和发布的唯一长期说明。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域规则见[领域文档索引](README.md)。代码、迁移和 CI 配置始终是实现细节的最终来源。

## 活跃代码边界

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 生产 React 界面、本机 SQLite WASM 学习库、账号与云同步 |
| `apps/browser-extension` | 网页/字幕阅读、采集、解释与 Web 交接 |
| `apps/api` | Hono 可选在线服务实现及本地开发入口；不执行学习协议 |
| `supabase/functions/sensa-api` | 生产 Edge Function 入口 |
| `packages/contracts` | Web、扩展与 API 共享协议 |
| `packages/learning-kernel` | 学习与调度纯规则 |
| `packages/content-validator` | 学习资源发布校验 |
| `packages/model-runtime` | 服务端与 Edge 的模型执行适配（Genkit flow、队列、提供方重试） |
| `db/migrations` | 生产数据库的前向迁移 |
| `content` | 内容 schema、prompt、制作与校验工具 |

`apps/sensa_native` 和 `crates` 只保留现有代码，不参与当前产品开发、验收或发布规划。除非 owner 明确恢复该范围，不在这些目录继续迁移或新增能力。

## 数据与同步

生产 Web 的个人学习库是 SQLite WASM 数据库 `sensa-local-library-v1.sqlite3`，持久化在浏览器
Origin Private File System。SQLite 在专用 Worker 中运行，使用不要求页面启用跨源隔离的
`opfs-sahpool` VFS；应用用页面生命周期 Web Lock 保证同一时间只有一个数据库 owner，因此第二个
Sensa 标签页会提示先关闭旧页面，而不是打开竞争连接。UI 只通过本机 `LibraryTransaction` 修改它，
不直接执行 SQL，也不写派生学习结果。Node 测试使用相同事务接口的内存 Adapter；浏览器交付必须
另验真实 OPFS。当前版本不读取或迁移旧 IndexedDB 数据。

旧 Web 应用层的逻辑表与新版 Personal Semantic World Journey 共用这一物理事务 authority；Journey
聚合保存在 `semanticWorld` 逻辑表中，不再写预览 `localStorage`。Journey 自己拥有领域事实、
快慢轨和 operation receipt，SQLite Adapter 只拥有原子读写。账号副本、界面偏好和其他
`localStorage` 状态不能充当个人学习库的第二权威。

学习运行时只在 Web 本机执行：目标选择、Protocol/Policy、步骤、评价、Completion、Memory Outcome 与
FSRS 都由本地领域事务结算。Hono/Edge 不创建或推进学习 Run，也不重新计算从云同步取回的学习事实。

普通账号云同步以本机已提交记录为输入。云端保存版本化清单和按内容寻址的数据块；下载按响应字节预算分页，客户端消费服务端返回的 deferred 列表。学习操作与学习事件的历史内容不可被重写。

同步记账和业务内容使用不同事件：只有真实业务写入广播内容变化，单纯更新同步状态不能再次触发内容同步。同步由账号接通、本机内容变化、恢复联网或窗口重新获得焦点触发；空闲标签不使用定时轮询。服务用量和其他在线状态按需读取。

下载内容在应用前验证摘要、引用和运行时可重放性，并在提交事务时重新检查账号、库和本机版本。冲突不得覆盖同步期间出现的新修改；无法自动合并时保留失败状态和明确重试入口。

协议和保护上限以以下源码为准：

- `packages/contracts/src/sensa/librarySync.ts`
- `apps/api/src/sensa/library/sync.ts`
- `apps/web/src/data/library/cloudSync.ts`
- `apps/web/src/data/library/store.ts`

Intake 的语义 payload 只声明一次：`packages/contracts/src/sensa/intake.ts`。它不携带运输目的地，
接收端仅按 Context、Expression、Sense 和 acceptance 的存在性走快/慢轨，不用模型评审
调用方已经提供的 Context 是否充足。表达的 canonical form 与 Context 中的 exact occurrence 分开，
例如可以保存 `back out` 并定位原文中的 `backed out`。当前 Web 本地 authority 在
`apps/web/src/experience/personalMeaningJourney/gateway.ts` 中幂等提交，相同 operation id 若改变载荷则报冲突。

本机 Agent 投递由 `integrations/codex/sensa-intake/sensa-intake.mjs` 提供。安装时它固定一个
`libraryId` 与 Agent client identity；每次提交只把 v3 Intake 幂等写入独立的 transport queue
SQLite，不读取或直写 Web 的 OPFS 数据库。Sensa Web 打开、恢复可见或获得焦点时，
`apps/web/src/experience/account/LocalAgentIntake.tsx` 经浏览器扩展 Native Messaging 拉取队列，交给同一个
Journey gateway 提交；只有本机事务成功后才写回 `applied` receipt。CLI 返回 `queued` 仅表示本机队列已
持久化，不能显示成已进入语义世界。本机投递不要求账号，队列 envelope 与 receipt 由
`packages/contracts/src/sensa/localAgentIntake.ts` 定义；扩展需要 `nativeMessaging` 权限并安装
`app.sensa.intake` host manifest。

设置页的“本机 Agent”通过 `web-native-intake-status` 读取扩展 id 和 host 的 library binding，UI 只显示
连接状态与必要动作。它按当前浏览器生成一条命令，自动选择 macOS 或 Linux 上 Chrome/Edge
的 Native Messaging 注册位置，从同一 Web release 的 `/integrations/` 下载 CLI、skill 和 wire example，
并将带有确定 executable/config 路径的 managed `sensa-intake` skill 安装到 Codex。集成资产不进入离线
App Shell，使用 `no-cache` 保证安装内容与当前发布对齐；已有非 Sensa-managed 同名 skill 不会被覆盖。
重复运行相同命令保留原 client identity 与 transport queue。

开发者仍可绕过图形入口直接运行：

```sh
node integrations/codex/sensa-intake/sensa-intake.mjs --setup \
  --library-id <CURRENT_LIBRARY_UUID> --label Codex \
  --directory <NEW_PRIVATE_CONNECTION_DIRECTORY> \
  --extension <CHROMIUM_EXTENSION_ID> \
  --manifest-dir <BROWSER_NATIVE_MESSAGING_HOST_DIRECTORY>
```

生成的 `connection.json` 是 Agent 选择目的库的连接文件；请求不能逐条改投其他库。

远程投递的 transport envelope 由 `packages/contracts/src/sensa/intakeDelivery.ts` 定义。
`apps/api/src/sensa/library/intakeDelivery.ts` 使用受认证账号和该账号唯一启用的 library channel
决定目的地，不允许 Agent 从 payload 选择 library。它只持久 mailbox item 并返回 `queued`；
`apps/web/src/experience/account/RemoteIntakeDelivery.tsx` 在账号恢复完成后登记当前库，在初始加载、
恢复联网或窗口获得焦点时拉取，由本地 gateway 提交后回传 `applied` 及具体快轨/Inbox
结果。空闲页面不轮询。Codex skill 已使用同一 v3 payload；未来 OAuth 或 MCP 只能是相同合同上的适配器，
不可另建一套 Intake 语义。数据库的账号/库隔离、唯一启用 channel 和 mailbox 存储由
`db/migrations/0028_sensa_encrypted_intake.sql` 与 `db/migrations/0032_sensa_intake_delivery.sql` 提供。

云端备份当前只有 `packages/contracts/src/sensa/accountBackup.ts` 的架构端口。它固定 immutable Recovery
Point manifest、摘要、大小、library/learner/schema identity 与 `account_assisted | zero_knowledge`
模式；仓库目前没有 backup route、store、scheduler 或 restore workflow。现有 account sync 仍是收敛服务，
不得在代码或 UI 中当作已实现备份。

Web 页面与扩展之间的桥也只声明一次：`packages/contracts/src/sensa/consumer/extension.ts` 同时声明握手（授权、交换、凭据）与页面桥（每种请求的载荷、每种应答的形状）。Web 应用按它构造请求并校验应答，`apps/browser-extension/src/background.ts` 在分发前解析每条桥消息——未声明的 kind 或字段一律拒绝，不再静默丢弃；页面侧的 `webBridge.ts` 是每个 Sensa 页面都会加载的内容脚本，因此不带 schema，它的两个频道名、id 上限与 kind 白名单由 `apps/browser-extension/build.mjs` 在构建时从同一份声明注入。授权这一轮同样共用：API 路由与 Web 前置校验读同一组 schema。`scripts/sensaBridgeContractSmoke.mts` 在快速测试里把真实 forwarder 与真实 background 装进同一台假浏览器，逐 kind 走一遍。

## 模型与内容边界

所有模型需求都经过同一个模型管理边界：每个用途（澄清 `teacher`、材料 `content`、审核 `review`、词义判定 `reference`、网页阅读 `reading`）都要声明用途与执行位置，再交给该位置的执行器。执行器只有两个，一个进程一个：设备侧 `apps/web/src/data/library/transport.ts` 与 `modelExecution.ts`，服务侧 `packages/model-runtime` 的 Genkit flow。这两处之外，任何代码都不得命名模型端点或引入提供方 SDK；`scripts/sensaModelManagementSmoke.mts` 在快速测试中做静态检查。

提供方只有两种：Sensa 服务与用户自填的连接。用户连接按保存位置决定执行位置。存在本机库 `providers` 表的连接在本页执行，密钥只保留在页面内存，不进个人库同步，请求由这台设备直接发出。存在账号侧的连接由部署密钥加密保管、在服务端执行；账号级连接登记处是 `db/migrations/0021_sensa_browser_reading.sql` 的 `reading_settings` 表，扩展与 Web 共用同一份，因此一个密钥只需配置一次。两种位置只差两点：本机连接可使用任意 HTTPS 地址与本机 HTTP 服务，但需要对方允许跨域，且不计入服务端用量；账号连接受部署白名单限制（`SENSA_READING_ALLOWED_ORIGINS`），并计入服务端用量。用途指派每次只属于一个登记处，切换用途即清除另一处。阅读的用途内部再按功能指派（划词、网页、字幕、阅读动作、句中意义、输入翻译）：每个功能一个指派键，`scripts/sensaReadingLanguageSmoke.mts` 在快速测试里保证功能清单与指派表、与阅读路由接受的请求枚举三者一致。

`reference` 用途默认由 Sensa 服务承担，并带独立预算池：`sensa_consumer.reference_usage`，上限 `SENSA_REFERENCE_DAILY_LIMIT`（默认 300）。`teacher` 使用 `sensa_consumer.native_semantic_usage`，`content`/`review` 使用 `sensa_consumer.native_content_usage`；后三者的默认上限均由 `modelDailyLimit=30` 控制。参考词典数据源（`api.wiktapi.dev`、`api.dictionaryapi.dev`）与浏览器语音、`dict.youdao.com` 音频不是模型提供方，不在本边界内。

模型输出只是候选。语义接受、学习资源校验、加入学习和运行时结算仍由对应应用与领域模块完成。常规测试使用替身，不调用付费模型或 TTS。

阅读请求由扩展的 background 在一个地方补齐学习者状态（语对与术语表），流式端口与普通消息共用这一步；模型连接测试与模型列表只带各自的问题。服务端的阅读、测试与列表三个入口只接受合同里声明的那三种请求体，`scripts/sensaReadingGlossarySmoke.mts` 在快速测试里逐个核对扩展实际发出的 body。

内容制作的命令、安全边界和无成本检查由 [`content/README.md`](../../content/README.md) 维护。生成数据、发布 JSON 和运行媒体不提交 Git。

## 本地开发

需要 Node.js 24 或更新版本。

```sh
npm install
npm run api:dev
npm run web:dev
```

Web 公共配置从 `apps/web/.env.example` 复制到 `apps/web/.env.local`。API 私有配置从 `apps/api/.env.example` 复制到 `apps/api/.env`。远程数据库连接必须使用受限运行角色并要求 TLS；迁移凭据只用于迁移。

需要数据库的本地检查使用一次性 PostgreSQL 17 数据库，例如：

```sh
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  node --import tsx scripts/db-migrate.ts

SENSA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  npm run test:db
```

测试数据库名称和地址必须满足相应脚本的隔离检查，不能指向 owner 或生产数据库。

## 验证

先运行覆盖改动边界的检查，再运行交付基线：

```sh
npm run check
```

Web 启动、账号恢复和空闲网络预算：

```sh
npm run test:browser
```

本机库、API、PostgreSQL 和浏览器同步合同：

```sh
npm run test:db
```

扩展构建与无付费交互检查：

```sh
npm run build -w @sensa/browser-extension
node --import tsx scripts/sensaBrowserPortSmoke.mts
node --import tsx scripts/sensaExtensionPopupSmoke.mts
```

脚本成功只能证明它覆盖的边界；真实账号、真实 Provider、浏览器商店和生产环境需要各自的验收证据。

## CI 与生产发布

`.github/workflows/sensa-consumer-check.yml` 在 pull request 和 `main` push 时运行 `Sensa CI`。它执行静态检查、构建、快速 smoke 以及 PostgreSQL/API 集成。

日常生产发布只有一个入口：`.github/workflows/sensa-web-deploy.yml`。发布流程：

1. 接收一个完整的 `main` commit SHA，并要求当次 owner 授权；
2. 等待该 SHA 的 `Sensa CI` 成功；
3. 使用生产配置构建 Web、扩展和 API 一次；
4. 校验并传递同一份固定制品；
5. 应用前向数据库迁移并对齐 Supabase Auth 配置；
6. 部署 Supabase Edge Function；
7. 上传 Cloudflare Worker 版本，先验证预览，再提升到生产；
8. 执行公网非模型 smoke 并保存发布证据。

命令行触发方式：

```sh
gh workflow run sensa-web-deploy.yml \
  -f release_sha=<FULL_MAIN_SHA> \
  -f owner_accepted=true
```

`.github/workflows/sensa-web-candidate.yml` 是可选的深度验证，不是日常发布前置。`.github/workflows/sensa-web-monitor.yml` 负责已启用环境的定时公网和聚合阈值检查。

所有生产部署都从 CI/CD 执行，不从本地 shell 调用 Provider 部署命令。迁移保持前向兼容；回滚 Web 版本时不能假设数据库也会回滚。

## 配置与安全

- 生产浏览器变量放在 GitHub environment variables；Provider token、数据库 URL 和 vault key 放在 environment secrets。
- `.env`、密钥、owner 数据、生成媒体和测试报告不得提交。
- 本地和 CI 测试使用合成身份、隔离数据库和受控网络依赖。
- 任何会产生费用的真实 Provider 调用，以及任何生产 push/deploy，都需要当次明确授权。
- 长期文档不记录 SHA、Workflow run ID、一次性机器路径、某轮通过数量或临时故障过程。
