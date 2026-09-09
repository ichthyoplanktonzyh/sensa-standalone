# 统一采集与原生本机交接大组

2026-09-09。Owner 已确认 Web 与原生分别持有本地副本，插件可选接收端，本地 Agent 优先调用本机接口。本组承接 [施工范围](native-intake-group-plan.md)，完成迁移清单第 5 组的本机接入。

## 实际行为

- 插件增加原生接收库发现、名称/标识确认，以及切回现有 Web 接收路径。阅读模型账号与保存目标独立；没有账号也能采集网页原文和 YouTube 字幕。既有在线解释仍可使用，明确确认后直接保存到原生语义世界。
- 原生桥接未就绪时先保存在插件队列，界面明确显示等待交接。收到 Rust 回执才称为已保存到原生库。队列固定 libraryId/clientId；换库不转投，重启浏览器仍可恢复，同一操作不重复创建。最多暂存 100 项未交接请求，完成项只留最近 20 项展示；完整历史回执在本机库。
- 桌面 `sensa-intake` 同时提供 JSON stdin CLI 与浏览器 Native Messaging。无需 Flutter 窗口常驻，不运行 Hono；CLI 只支持 hello、submit、receipt。不会运行模型、返回全库快照或执行学习命令。
- 原生词义世界增加采集接入、明确预览后导入 JSON、刷新按钮及返回应用时刷新。收件箱内容继续使用既有澄清/直接接受路径。完整内容经接受后进入语义世界，加入学习仍是独立操作。
- Codex Skill 位于 `integrations/codex/sensa-intake`，可复制安装；本轮未替 owner 选择真实库、安装个人 Skill 或设置其浏览器接收目标。

## 合同与事务

共享合同为 `packages/contracts/src/sensa/consumer/localIntake.ts`，版本 `sensa-intake-v1`，复用现有 CaptureSnapshot 和 SemanticProposal。视频来源固定 videoId、起止毫秒与来源网址。Occurrence 索引计 Unicode code point；必需 Context，缺 Expression/Sense 时保存待处理，Focus 非必填。

resolution 可为空、proposal 或本机已知 local_binding。proposal 没有 acceptance 时只是候选，可在原生确认；明确 acceptance 才形成稳定意义。CLI 的接受还需 `--allow-accept`，Skill 仅在已有用户授权时使用；插件传直接点击确认，不能伪装 Agent 委托。authorization 是调用方记录的授权依据，不冒充服务端认证或密码学证明。

Rust 一次 SQLite 事务校验目标库、输入、表达对齐、语义提案与接受条件，写入既有语义身份/意义/操作账本及独立回执。回执按 clientId/operationId 保存 requestDigest；重复返回原回执，同 ID 改内容拒绝。重复捕获使用既有内容身份；来源标题或捕获时间变化不会重复建内容，也不会覆盖首次来源。已有不同语义处理结果、已移除内容不被外部提交默默覆盖或恢复。摄入不会写学习结果、计划、Evidence 或调度。

库 schema 15 → 16 只新增 `native_intake_receipts`；历史迁移向量同步更新并验证。浏览器不获得库文件路径或数据库访问权限，只通过登记的扩展 origin 和固定连接调用有界接口。CLI 配置选择属于本机用户权限，配置目录在 Unix 为 0700、配置文件 0600；不宣称它能隔离同一 OS 用户控制的恶意进程。

Web 保留现有 API/outbox 路径，并未被改成本地客户端。本组没有让 Web/Rust 共写数据库、启用同步或建立远程 Agent 投递服务。

## 桌面接入工具的配置

当前交付是可工作的接入工具与迁移设置入口，正式桌面安装包向导在第 6 组处理。构建：

```sh
cargo build --release -p sensa-library --bin sensa-intake
```

先在原生「我的词义世界 → 采集接入」复制库位置。为一次明确选择创建一个新的连接目录（目录不能已存在）：

```sh
target/release/sensa-intake --setup \
  --library '/absolute/path/to/library.sqlite' \
  --label '我的学习库' \
  --directory '/absolute/path/to/new-connection' \
  --extension '已安装插件的32位扩展ID' \
  --manifest-dir '/absolute/path/to/browser-user-data/NativeMessagingHosts'
```

配置会复制接入可执行文件、写 `connection.json` 与 `app.sensa.intake.json`。扩展 ID 限定该插件；安装过程不覆盖已有登记文件。macOS 常规 Chrome 默认用户数据位置为 `~/Library/Application Support/Google/Chrome`，Chromium 为 `~/Library/Application Support/Chromium`；自定义 user-data-dir 应使用对应目录。本轮真实进程测试覆盖 macOS Chromium 自定义目录。更换目标需明确替换该浏览器的登记清单后，在插件重新发现并确认；旧队列仍固定原连接。回到旧连接才能重试其请求。

Agent-only 配置省略 `--extension` 与 `--manifest-dir`，不安装浏览器桥接。Linux/Windows 二进制使用同一 Rust 实现；Windows Native Messaging 还需要在对应浏览器的当前用户注册表 NativeMessagingHosts 项登记生成的清单。本轮未声称 Linux/Windows 的实际安装或签名已验收。

CLI 示例（个人内容只经 stdin，不放命令参数）：

```sh
printf '%s' '{"kind":"hello"}' | /absolute/path/to/new-connection/sensa-intake
/absolute/path/to/new-connection/sensa-intake --allow-accept < request.json
```

`request.json` 为 `{ "kind": "submit", "request": <sensa-intake-v1 请求> }`；Skill 的 `request-example.json` 提供载荷样例，必须替换连接身份及操作 ID。保存待处理无需 `--allow-accept`。查询回执使用 `{kind:"receipt",libraryId,clientId,operationId}`。缺少回执只能表示尚未确认；不创建新操作 ID 来绕过失败。更新工具时应保留原 connection.json 与 clientId，避免误建新连接。

## 验收记录

- Rust 原子接受/待处理、无授权拒绝、撤回保护、来源时间去重、既有语义冲突、同操作改内容拒绝、跨库/调用方隔离、并发重试一次提交，及历史 workspace 迁移/学习回归。
- 真实 CLI 与 Native Messaging 长度帧、扩展 origin 限制、Agent 显式授权开关、单操作回执；共享 TS schema 的真实输入交给 Rust 并校验回执摘要。
- 独立 Chromium profile 中，真实工具栏选词 → 原生 host → SQLite；主机断开后排队、浏览器进程重启、恢复原连接提交；在线解释账号与本机接收目标分离；确认意义写入原生；无在线账号的 YouTube 字幕选词和毫秒定位保存。全部使用本机 HTTP/页面 fixture，无付费服务。
- macOS 与 Android：错误库拒绝、预览取消无写入、待处理、重复导入、完整提案明确确认、来源视频定位、刷新展示、没有自动入学、独立启动冷恢复。
- 原有 popup 状态反馈与重复点击保护、网页翻译/恢复、字幕读取/选词/定位/SPA 清理、模型设置回归通过。
- 根级 typecheck/build/lint、Flutter analyze、Rust Clippy all-targets `-D warnings` 与 bridge locked 检查；Skill validator。

主验证脚本为 `scripts/sensaNativeIntakeSmoke.mts` 与原生 `integration_test/intake_test.dart`。所有库和登记清单均为隔离合成资料。测试后移除专用 Native Messaging 清单、关闭测试浏览器，恢复临时 Debug 签名配置；owner Release 应用保持运行，Android 保持飞行模式且 Wi-Fi 关闭。没有推送或部署。

完整网页来源兼容性与真实 YouTube 外部可用性继续沿用已有浏览器验收边界；本轮验证新的本机交接，不以合成播放器代替真实网站兼容性声明。Web 本地化、三端同步、远程 Agent、移动系统分享入口与正式发布安装属于后续蓝图/发布工作。已有 TS 成果的原生迁移现剩第 6 组正式产品界面；这不代表 M3 已完成。
