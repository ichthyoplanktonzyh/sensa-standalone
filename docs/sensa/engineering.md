# Sensa Web 工程说明

本文维护当前仓库的开发、数据保护、验证与发布入口。产品行为见 [Web 产品说明](product-requirements-v1.md)，领域所有权见[领域文档索引](README.md)，生产支持见[支持与恢复手册](support-recovery.md)。源码、迁移和 CI 配置是实现细节的权威；本指南不复制内部算法、常量、测试数量或开发历史。

通用基础能力先对照成熟模式：学习状态、队列、限制与历史参考 Anki，本地事实与可重建索引参考 Obsidian；只为 Web 平台和 Sensa 的真实语义差异增加机制。例如，[Anki 浏览表](https://github.com/ankitects/anki/blob/main/qt/aqt/browser/table/model.py)按身份和窗口读取内容；本机数据库的事务和维护遵循 [SQLite WAL](https://sqlite.org/wal.html)，云端保留期维护遵循 [PostgreSQL vacuum](https://www.postgresql.org/docs/current/routine-vacuuming.html)。参照模式不代表已经验证相同容量或性能。

## 活跃代码边界

当前交付范围是 Web、浏览器扩展、API、共享包、内容管线与部署基础设施。`apps/sensa_native` 和 `crates` 保留现有代码，原生开发、迁移与跨端验收暂停，恢复该范围需要 owner 明确授权。

| 路径／入口 | 职责 |
| --- | --- |
| [`apps/web`](../../apps/web) | React Product Shell、本机持久化与在线适配 |
| [`learningSystem.ts`](../../apps/web/src/learning/system/learningSystem.ts) | Learning command、projection 与查询失效订阅；Protocol、评价和协调封装在模块内 |
| [`contentSupplySystem.ts`](../../apps/web/src/contentSupply/system/contentSupplySystem.ts) | 内容发现、准入、安装、材料准备与公共缓存恢复 |
| [`personalContentSystem.ts`](../../apps/web/src/personalContent/system/personalContentSystem.ts) | 收藏、笔记与个人学习场景 |
| [`apps/web/src/learnerSemanticProjection/system`](../../apps/web/src/learnerSemanticProjection/system) | 跨领域只读投影，不拥有来源事实 |
| [`apps/browser-extension`](../../apps/browser-extension) | 阅读、采集、本机模型与 Web 交接 |
| [`apps/api`](../../apps/api)、[`supabase/functions/sensa-api`](../../supabase/functions/sensa-api) | 可选在线能力及生产 Edge 入口，不执行学习结算 |
| [`packages`](../../packages) | 共享合同、纯学习规则、内容校验、模型执行及 MCP adapter |
| [`db/migrations`](../../db/migrations) | 前向数据库迁移 |
| [`content`](../../content) | 作者来源、制作工具与不可变内容发布 |

页面通过所属模块的 command/query/subscribe 接口工作，不直接取得逻辑表、SQL、Kernel 原语或跨领域写入权限。目录、页面、HTTP route 和同步记录都不是第二份领域权威。可重建索引与正式写入保持事务一致，重建不得补造或改写来源事实。

Web 的路径与 search 由路由合同管理；Shell、内容和 Runtime 按需加载。展示只消费实际读取成功的投影；错误、未知和未就绪不能被转成空库、零进度或成功。Skin、偏好与导航不改变领域状态，呈现合同见 [DESIGN.md](../../DESIGN.md)。

## 数据与同步

Web 在专用 Worker 中通过 SQLite WASM／OPFS 保存个人学习库。同源标签页协调唯一物理数据库 owner，并以共享／排他事务保护完整读改写。内存 adapter 的通过不能代替原生 OPFS、Worker 和多标签页验证。

持久化和恢复必须保持以下边界：

- 所有个人修改先在本机事务提交。账号和在线服务不是已有本机学习资料的准入前提；服务端不重复执行学习协议或结算。
- 已有使用线索而库身份缺失、存储读取失败或版本不可识别时，保留原文件并进入恢复，不能初始化替代空库、删除 pool 或用内存 fallback 冒充恢复成功。
- 明确“重新开始”另建独立资料库并退出账号，保留旧目录、损坏指针和恢复材料；旧标签页停止读写。库相关草稿和会话不自动迁入新库。
- 备份只恢复到允许的空目的地。解密、预览和最终写入都核对身份、账号及目的地占用，拒绝覆盖期间新增的资料；设备身份不从源快照继承。
- 账号连接先核对本机 owner 和云端资料。双方非空、owner 不符或预检失败时保留原资料与真实未知／冲突状态，不能静默认领、合并或上传空库。
- 明确退出以本机事务保存退出状态和 epoch，退休旧回调、在途服务请求与跨标签页回复；新的有效登录才能重新连接。退出保留本机资料。
- 清除本机资料不删除云端副本；清除后的自动启动、联网或重试不能重新拉回旧资料，只有明确重连才允许恢复。未上传修改必须先同步或由用户明确丢弃。
- 命令重试返回原回执；提交结果未知时核对原命令，不能自动重放底层写入。提交后的维护或投影读取失败不得把已经保存的事实报告为未保存。
- 数据库的提交持久性不能为了基准耗时而降低；健康扫描和维护不作为每次页面读取的前置条件。
- 同步先验证私有候选的结构、身份、完整历史与领域约束，再原子应用。普通内容冲突需重新核对用户看过的版本；学习历史由专用 reconciliation 保留，不以最后写入或普通选择器覆盖。
- Device Operation Ledger 只负责设备幂等，不进入 Cloud Checkpoint。可重新下载的公共包和媒体是缓存；同步收敛不是历史备份，Remote Intake 的 `queued` 也不是本机已保存。

实现入口按问题定位，不在本文复制预算、索引和协议版本：

| 边界 | 源码入口 |
| --- | --- |
| 本机事务、身份与回执 | [`store.ts`](../../apps/web/src/data/library/store.ts) |
| Worker、锁与 pool 生命周期 | [`sqliteCoordinator.ts`](../../apps/web/src/data/library/sqliteCoordinator.ts)、[`sqlitePoolLifecycle.ts`](../../apps/web/src/data/library/sqlitePoolLifecycle.ts) |
| 同步状态、调度与传输 | [`cloudSync.ts`](../../apps/web/src/data/library/cloudSync.ts)、[`cloudSyncService.ts`](../../apps/web/src/data/library/cloudSyncService.ts) |
| 各领域准入与 reconciliation | [`replication`](../../apps/web/src/data/library/replication)、[ADR 0004](../adr/0004-local-facts-cloud-checkpoints.md)、[ADR 0005](../adr/0005-concurrent-learning-history-reconciliation.md)、[ADR 0008](../adr/0008-personal-meaning-conflict-decisions.md) |
| 备份、清除与账号删除 | [`backup.ts`](../../apps/web/src/data/library/backup.ts)、[`dataControl.ts`](../../apps/web/src/data/library/dataControl.ts) |
| 登录与退出边界 | [`apps/web/src/data/account`](../../apps/web/src/data/account)、[`AccountExperience.tsx`](../../apps/web/src/experience/account/AccountExperience.tsx) |

## 模型与内容边界

模型请求经过声明用途和执行位置的统一边界：设备侧由 Web transport/model execution 执行，托管服务由 [`packages/model-runtime`](../../packages/model-runtime) 执行，扩展自带模型由受信任后台执行。密钥、用途指派、预算、取消和幂等由这些实现负责，页面不另建 Provider SDK 或模型端点。

本机连接的密钥不进入个人库同步；账号连接由服务端加密保管并受部署白名单限制。扩展内容页、设置响应、URL 与日志不得接收密钥。个人 Context 和媒体只按用户授权的用途发送；一次授权不自动授予另一个用途或接收方。

Semantic、Content、Review 与 Reference 职责分别校验。模型候选、工具 preflight 和流式回复不能直接形成 Semantic Acceptance、已批准材料、Learning Evidence 或调度结果；请求取消、账号变化或页面离开后，迟到响应不能提交到新作用域。已经执行或执行结果未知的付费请求不能自动退款或重跑。

公共内容以不可变身份、版本和摘要准入；安装、应用更新、加入学习是不同动作。已提交 Action 仍引用当时材料，兼容新材料只按既有规则影响未操作步骤。作者制作、Portable 发布、语音工具及无成本 smoke 由 [`content/README.md`](../../content/README.md) 和[内容生产 SOP](content-production-sop.md)维护，本文不保留第二份制作流程。

YouGlish 等外部媒体按真实供应商事件报告准备和播放状态，失败保留文本或重试出口，不能产生正式学习事实。商业发布前需核对[供应商许可](https://youglish.com/api/doc/js-api)；受控回归不证明真实媒体、声音或安装权限已验收。

## 本地开发

需要 Node.js 24 或更新版本：

```sh
npm ci
npm run dev:sensa
```

受管入口提供完整 Web／Auth／API／同步／Intake 环境、专用浏览器资料和开发扩展：

| 入口 | 用途 |
| --- | --- |
| `npm run dev:sensa` | 热更新，Web 位于 `http://127.0.0.1:3000` |
| `npm run preview:sensa` | production build／Service Worker 验收，Web 位于 `http://127.0.0.1:4173` |
| `npm run test:local-preview` | 无头验证本地登录、OPFS 持久化及 loopback 边界 |
| `npm run dev:sensa:models`、`npm run preview:sensa:models` | 显式启用真实模型，须先取得费用授权 |
| `npm run reset:sensa` | 关闭入口后，明确重建本地测试数据库及开发／预览浏览器资料 |

启动器 [`scripts/local/sensaLocal.mjs`](../../scripts/local/sensaLocal.mjs)移除继承的生产配置，只接受 loopback Auth／API，管理隔离 PostgreSQL 和 `.sensa-local` 专用浏览器资料。测试身份为 `local@sensa.invalid`，本地验证码为 `123456`，不发送邮件。普通入口暂停托管模型，不读取模型密钥或调用 TTS。

模型 opt-in 从 shell、`apps/api/.env`、仓库 `.env` 按顺序读取白名单模型变量，实际 Provider 要求以启动器为准；它会产生真实请求。`SENSA_LOCAL_PUBLIC_CATALOG_URL` 可显式固定已发布公开目录的只读快照，目录校验失败停止启动；账号、同步和私有配置仍保持本地隔离。

开发与预览使用不同 Origin 和浏览器资料，复用同一本地账号数据库。开发服务不注册发布版离线壳；断网导航、冷启动与安装态行为使用 production preview。真实 iOS／Android 的触感、safe area 和软键盘仍需实际设备验收，桌面模拟不构成该证据。

关闭浏览器或 `Ctrl+C` 停止本轮 Web／API，数据库容器保留；reset 不得扩展到日常浏览器或生产资料。本地与线上 Agent credential 不得互相复制。

原始 `api:dev`、`web:dev`、`web:preview` 仅用于单模块调试。公共／私有配置分别见 [`apps/web/.env.example`](../../apps/web/.env.example) 和 [`apps/api/.env.example`](../../apps/api/.env.example)，受管入口不读取其中的生产配置。远程数据库使用 TLS 和受限运行角色，迁移凭据只用于迁移。

数据库检查使用一次性 PostgreSQL 17，例如：

```sh
MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  node --import tsx scripts/db-migrate.ts
SENSA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/sensa_m1a_test \
  npm run test:db
```

地址和库名必须通过脚本的隔离检查，不能指向 owner 或生产数据库。连接池预算、SQL／锁超时和日志策略以 [`apps/api`](../../apps/api) 的配置与测试为准；单实例池上限不是全局容量证明。

## 验证

先运行覆盖改动边界的检查，再运行交付基线 `npm run check`（typecheck、build、固定 Node 门禁）。Web 测试只使用 Vitest 和 Playwright Test；独立负载／容量工具不作为第三套通用运行器。实际目录、风险和 CI 选择分别由 [`catalog.mts`](../../tests/web/catalog.mts)、[`journeyMapping.mts`](../../tests/web/journeyMapping.mts)、[`ciWhitelist.mts`](../../tests/web/ciWhitelist.mts)维护，不在文档抄写案例数。

```sh
npm run check
node --import tsx tests/web/run.mts --journey=LJ-16 --list
node --import tsx tests/web/run.mts --suite=fast --id=<TEST_ID>
node --import tsx tests/web/run.mts --suite=browser --id=<TEST_ID>
```

| 边界 | 检查入口与条件 |
| --- | --- |
| 纯逻辑、合同、集成与静态质量 | Vitest；按目录的风险／环境筛选 |
| 构建产物 | `built-web-artifact`；先构建 |
| Chromium、OPFS、生命周期、扩展 | `npm run test:browser` 或目录中的聚焦 Playwright 项 |
| API／Edge | `npm run test:edge` |
| PostgreSQL／RLS／浏览器加数据库 | `npm run test:db`；使用已迁移的隔离库及受限测试角色 |
| 固定 CI 分组 | `test:ci:node`、`test:ci:postgres`、`test:ci:e2e`；`test:ci` 不包含 typecheck／build／edge |
| Skin 合同 | `npm run test:skin` |
| 扩展构建、安装与交互 | [`apps/browser-extension/README.md`](../../apps/browser-extension/README.md)及登记用例 |
| Python 内容 | 编译与无成本 validator smoke，见 [`content/README.md`](../../content/README.md) |
| 性能／容量 | 显式专项与 [`scripts/assessment/README.md`](../../scripts/assessment/README.md)，不进入普通 CI 的固定门禁 |

目录运行器保留原生引擎隔离、fixture 生命周期和报告，不把旧报告、遗漏文件或额外跳过算作成功。报告位置与保留期以运行器和 workflow 为准；失败 trace、截图和原结果不得被重试覆盖。只使用合成身份、隔离存储与受控网络，真实模型、邮件、TTS、安装权限和生产服务另行授权验收。

长旅程 checkpoint 以[用户旅程](user-journeys.md)的目标和合法出口为准。关闭前核对页面衔接、必要异常与恢复、持久状态、相关性能／容量风险及独立使用验收。给审查者用户目标与必要边界，不提供操作答案或修改生产实现的权限；不同旅程采用新的独立审查视角，子智能体使用仍遵循 AGENTS.md 的 owner 授权条件。测试链接、固定 CI 绿色和单次顺利使用都不证明整条旅程完成。

性能测量分别记录准备、传输、校验、提交与可交互时间，以及规模、媒体、设备／CPU、网络、冷暖状态和预算。生成的学习容量事实必须经过正式命令与完整 replay，不能直接填造完成或 FSRS 字段。小样本、内存 adapter、受控 HTTP、构建大小和本机模拟不能互相冒充容量、原生存储、生产服务或真实设备 CWV 证据。保留既有数据断言与交互预算，不能通过删测试、放宽预算或把失败改告警取得通过。

体验目标与回归硬上限分开：首个可见反馈以 200ms 为目标，频繁的本机读取、评分、下一条与运行恢复以 500ms 为目标。超出目标的样本不能宣称达标；容差与具名预算由[交互预算工具](../../tests/web/support/interactionBudget.ts)和对应测试维护，不代表参照产品已在同机同规模下比较通过。

### 证据保存与任务接续

定义、测试关联和执行结果分别保留：文档定义当前需求，测试映射说明断言边界，原生报告、CI run／attempt 和发布 manifest 记录实际结果。保留被测 revision、工作树差异及条件；历史结果不改写为当前通过，任务接续不另建手工进度／通过表。

原始证据可使用不可覆盖的本机归档：

```sh
node --import tsx scripts/archiveJourneyEvidence.mts --discover \
  --output=output/playwright/evidence-archives/<new-name>
node --import tsx scripts/archiveJourneyEvidence.mts --sources=<paths.json> \
  --output=output/playwright/evidence-archives/<new-name>
node --import tsx scripts/archiveJourneyEvidence.mts \
  --verify=output/playwright/evidence-archives/<name>/manifest.json
```

归档前核对来源列表；自动发现不证明证据齐全。工具只复制并核验字节／SHA-256，不运行报告中的脚本、不调用网络、不判定通过。目录私有且 Git ignored；完整 profile、凭据和填充环境文件不得归档。`inventoryGitCommit` 不是报告的被测版本，原文不做脱敏；重复目录或摘要不符时拒绝覆盖。归档随本机工作资料另行备份。

重要 CI 证据在到期前下载核验。保留本次必要证据后，只回收本轮启动的临时 worktree、浏览器和一次性数据库；不扫描删除 owner profile、旧证据或其他工作树。缺陷、未验证准备和延期能力进入 issue tracking，不在整理文档时扩大实施范围。

## CI 与生产发布

[`sensa-consumer-check.yml`](../../.github/workflows/sensa-consumer-check.yml)在 PR 与 main 使用相同固定门禁。main 以公开候选配置构建并密封一次应用候选；只有同仓库、精确 main SHA 的绿色 CI、原始构建 provenance 和不可变 artifact 全部通过核验，才具备发布资格。构建 attempt 与测试验证 attempt 分开记录，失败 run 中存在 artifact 不代表可发布。

唯一编排入口是 [`sensa-release.yml`](../../.github/workflows/sensa-release.yml)。正常自动路径接收绿色 main CI，只批准版本化策略允许的普通 application-only 变化；迁移、基础设施、生产配置、内容／共享内容合同、Edge 入口和 API authentication/access authority 的变化需要 owner 对精确 revision 显式授权。等待授权、no-op、执行失败和成功分别报告。既往一次性豁免不授予后续 revision 发布资格。

发布顺序与边界：

1. Planner 从已核验系统清单和目标差异决定必要组件，显式 scope 不能省略必要组件；缺少可信基线时要求完整 bootstrap。
2. 固定绿色 CI run／验证 attempt、候选 artifact ID／构建 attempt和目标摘要；应用部署不重新构建。
3. 所有所需组件先完成只读预检；内容同时构建、校验并封存一次。任一必要预检失败，组件均不能开始生产写入。预检不证明未来写权限、迁移耗时或未执行的语义兼容。
4. 完整应用发布先完成 backend 的前向迁移、Auth／服务配置与 API 部署，再上传 Worker 版本、核对预览并提升，应用域名 triggers，最后核对生产文件、API 构建身份及实际 100% 流量；Web-only 保留其受限发布边界。
5. 联动发布按 Application → Content；应用先兼容当前 Registry。内容消费预检封存产物，按不可变 Book archive → Registry 上传并回读后提升，不覆盖或删除旧对象。
6. 组件核验完成后才生成成功系统清单；原生 Release 保存原候选字节和系统清单，摘要核验后才发布归档。未完成归档如实报告 `verified-but-unarchived`，不能重跑部署来代替归档重试。

仅 Web 变化且存在完整核验基线时，`scope=auto` 可选择 `web-only`，沿用原 API、迁移和生产配置。公开目标漂移直接拒绝，不扩大写入权限。候选过期不得临时构建未测试代码；回退需另行授权，并证明旧应用与当前 API、迁移和内容兼容。数据库只做前向修复，应用回退不代表数据库回退。

| 发布事实 | 权威入口 |
| --- | --- |
| 计划、自动授权与组件选择 | [`scripts/release`](../../scripts/release)、[`sensa-release.yml`](../../.github/workflows/sensa-release.yml) |
| 候选来源与密封 | [`candidateSource.mjs`](../../scripts/release/candidateSource.mjs)、[`releaseCandidate.mjs`](../../scripts/release/releaseCandidate.mjs) |
| 生产字节、API 身份与流量核验 | [`liveVerification.mjs`](../../scripts/release/liveVerification.mjs) |
| 状态、记录与归档 | [`releaseStatus.mjs`](../../scripts/release/releaseStatus.mjs)、[`releaseArchive.mjs`](../../scripts/release/releaseArchive.mjs) |
| 内容来源、媒体包与版本规则 | [`content/README.md`](../../content/README.md)、[`sensa-learning-content-publish.yml`](../../.github/workflows/sensa-learning-content-publish.yml) |

失败后使用 Actions **Re-run failed jobs**，保留成功 plan、版本及产物 ID；不重跑成功 plan 或用 **Re-run all jobs** 重算基线：

| 失败阶段 | 续跑原则 |
| --- | --- |
| plan 未成功 | 确认无组件写入后从统一入口发起新 run |
| preflight／内容准备 | 修复失败项，沿用原 plan 和已成功封存产物 |
| backend | 核对实际迁移、配置与 API 状态，重跑失败 job；命令失败也可能留下部分变更，不能认领生产未变化或已自动回滚 |
| Web upload | 保留成功 backend；回执未知时先核对 Cloudflare，不能认领可复用版本 |
| preview／promote／smoke | 沿用原 version ID，已是目标 100% 时跳过提升，继续核验 |
| content | 保留已成功应用及原内容 build attempt，相同摘要对象只读跳过；内容未写入不代表整个系统未变化 |
| record／archive | 仅补失败的记录或归档，沿用成功组件精确输出 |

产物过期或成功输出不可恢复时，先核对实际生产状态，不能按同名／最新产物猜测。新的 dispatch 是新发布请求，不是自动恢复部分部署。

策略例外、完整 bootstrap、明确重发或恢复使用 owner 授权入口；以下命令只说明调用方式：

```sh
gh workflow run sensa-release.yml \
  -f release_sha=<FULL_MAIN_SHA> -f scope=auto -f owner_accepted=true
```

完整 bootstrap 使用 `scope=all`；内容发布使用 `scope=content`，两者需要时固定 `media_release_tag` 与完整 `media_pack_sha256`。精确参数和默认值以 workflow 为准，不从本地 shell 直接调用 Provider 部署命令。

仅迁移现有上线版本的网址使用 [`sensa-web-domain.yml`](../../.github/workflows/sensa-web-domain.yml)，保持应用版本不变，另验公开边界及真实邮件登录。深度候选、容量专项、监测及维护入口见 [`infra/README.md`](../../infra/README.md)和 workflow；监测／维护只用独立受限身份，不能写账号、学习事实或活动 head。告警、备份与恢复演练的要求见[支持手册](support-recovery.md)，workflow 成功不能代替这些验收。

## 配置与安全

- 正式 Web 入口是 `https://learnsensa.com`，目标与 Custom Domain 由 [`wrangler.jsonc`](../../wrangler.jsonc)和 GitHub environments 固定。Web、API CORS、Supabase redirect 与扩展目标一致；网址变更不复制或清除旧 Origin 的资料。
- `VITE_*` 只含公开浏览器配置。数据库 URL、Provider token、vault key 和 Supabase Secret／service-role key 只能留在服务端 secrets，不进入浏览器、报告、日志或 Git。
- 账号认证与业务邀请资格分开；邮件验证不自授服务资格，刷新 token 不代替敏感删除的新鲜验证。正式 SMTP／Hook、受邀身份与真实邮箱验收按[支持手册](support-recovery.md)处理，不能用管理员链接或受控 Auth 冒充真实登录。
- 日志只记录 request ID、release、固定错误类别与允许的计数，不输出正文、邮箱、URL token、SQL、堆栈或嵌套 cause；日志故障不得替换原异常。
- `.env`、密钥、owner 数据、生成内容／媒体与原始测试报告不提交。本地与 CI 使用合成身份、隔离库和受控网络。
- 真实 Provider／TTS 费用和生产 push／deploy 需要明确授权；生产变化只通过 CI/CD。
- 长期文档不记录 SHA、Workflow run ID、一次性机器路径、某轮通过数量或临时故障过程。完成记录由 Git／CI 保留，未完成事项进入 issue tracking。
