# Sensa Web 工程说明

本文是当前 Web 工程、验证和发布的唯一长期说明。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域规则见[领域文档索引](README.md)。代码、迁移和 CI 配置始终是实现细节的最终来源。

## 活跃代码边界

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 生产 React 界面、本机 IndexedDB 学习库、账号与云同步 |
| `apps/browser-extension` | 网页/字幕阅读、采集、解释与 Web 交接 |
| `apps/api` | Hono 服务实现及本地运行入口 |
| `supabase/functions/sensa-api` | 生产 Edge Function 入口 |
| `packages/contracts` | Web、扩展与 API 共享协议 |
| `packages/learning-kernel` | 学习与调度纯规则 |
| `packages/content-validator` | 学习资源发布校验 |
| `packages/model-runtime` | 默认与兼容模型执行适配 |
| `packages/intake-transport` | 采集传输协议 |
| `db/migrations` | 生产数据库的前向迁移 |
| `content` | 内容 schema、prompt、制作与校验工具 |

`apps/sensa_native`、`crates` 和 `apps/web-next` 只保留现有代码，不参与当前产品开发、验收或发布规划。除非 owner 明确恢复该范围，不在这些目录继续迁移或新增能力。

## 数据与同步

生产 Web 的个人学习库位于 IndexedDB `sensa:local-library:v1`。UI 通过本机应用层事务修改它，不直接写派生学习结果。账号副本、旧 consumer 存储和预览数据与该库保持隔离。

普通账号云同步以本机已提交记录为输入。云端保存版本化清单和按内容寻址的数据块；下载按响应字节预算分页，客户端消费服务端返回的 deferred 列表。学习操作与学习事件的历史内容不可被重写。

同步记账和业务内容使用不同事件：只有真实业务写入广播内容变化，单纯更新同步状态不能再次触发内容同步。同步由账号接通、本机内容变化、恢复联网或窗口重新获得焦点触发；空闲标签不使用定时轮询。服务用量和其他在线状态按需读取。

下载内容在应用前验证摘要、引用和运行时可重放性，并在提交事务时重新检查账号、库和本机版本。冲突不得覆盖同步期间出现的新修改；无法自动合并时保留失败状态和明确重试入口。

协议和保护上限以以下源码为准：

- `packages/contracts/src/sensa/librarySync.ts`
- `apps/api/src/sensa/library/sync.ts`
- `apps/web/src/data/library/cloudSync.ts`
- `apps/web/src/data/library/store.ts`

## 模型与内容边界

默认模型请求通过 Sensa API 和 `packages/model-runtime`。Web 自定义服务配置只保存非密钥信息；用户密钥停留在当前页面内存，不进入个人库同步。扩展的服务端连接凭据使用部署密钥保护，不进入扩展 storage、日志或版本库。

模型输出只是候选。语义接受、学习资源校验、加入学习和运行时结算仍由对应应用与领域模块完成。常规测试使用替身，不调用付费模型或 TTS。

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
  npm run sensa:library-cloud-smoke
```

测试数据库名称和地址必须满足相应脚本的隔离检查，不能指向 owner 或生产数据库。

## 验证

先运行覆盖改动边界的检查，再运行交付基线：

```sh
npm run typecheck
npm run build
npm run lint
```

Web 启动、账号恢复和空闲网络预算：

```sh
npm run sensa:web-bootstrap-budget
```

本机库、API、PostgreSQL 和浏览器同步合同：

```sh
npm run sensa:library-cloud-smoke
```

扩展构建与无付费交互检查：

```sh
npm run build -w @sensa/browser-extension
node --import tsx scripts/sensaBrowserPortSmoke.mts
node --import tsx scripts/sensaExtensionPopupSmoke.mts
```

`scripts/acceptance/catalog.mjs` 是现有测试资产索引，不是功能完成表。脚本成功只能证明它声明的边界；真实账号、真实 Provider、浏览器商店和生产环境需要各自的验收证据。

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
