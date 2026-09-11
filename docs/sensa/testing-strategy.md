# Sensa 测试层级与执行约定

2026-09-09，owner 已确认：日常功能验证以程序自动化为主，整组完成集中做平台与体验验收。
本文落实该约定，不改变领域规则、迁移范围或生产发布门。当前正式原生 UI 仍未完成。

## 层级按真实边界划分

| 层级 | 证明的事情 | 不能由此推出 |
| --- | --- | --- |
| 静态/构建 | 类型、编译、依赖和可构建性；Flutter analyze、Rust Clippy | 业务正确、设备可用。根级 lint 当前只是 typecheck 的别名，不能算独立 lint 证据 |
| 内核/事务/差分 | TS/Rust 固定输入的规则一致性、SQLite 原子提交/去重/恢复、Profile 实际选择执行器 | UI 接线、模型质量、多副本合并、完整领域证明 |
| 页面/交互 | Widget 或浏览器 DOM 的可见状态、交互、错误反馈、窄宽度/键盘 | 被替换的后台、OS 界面和真实持久化 |
| 应用旅程 | 用户操作通过真实应用组件抵达真实库，并检查结果和重启恢复 | 替身服务、真实第三方站点、安装包行为 |
| 平台/实况/体验 | 安装后的应用、系统权限/文件选择器、真实网站/Provider、视觉和实际操作 | 未运行的平台；一次实况可用也不代表未来长期可用 |

`testWidgets`、`integration_test`、Playwright 都是工具名，不是证据级别。例如
`provider_storage_test.dart` 直接调用凭据组件，属于平台集成；popup 脚本替换了
chrome.runtime，属于交互测试；Native Messaging 脚本实际经过扩展后台、本机进程和 SQLite。
Flutter integration_test 不操作 OS 文件选择器/权限弹窗；这些需另选原生自动化或实际操作。
依据：[Flutter 官方说明](https://docs.flutter.dev/testing/overview)、
[Playwright 用户可见行为与诊断建议](https://playwright.dev/docs/best-practices)。

不建立全仓 blanket 单元测试工程。优先维护高风险内核规则、真实事务和主要用户旅程；只在
交互分支复杂或需要精确布局反馈时加组件测试。四阶段只保留扩展性验证。

## 执行入口与证据目录

可执行目录是 [`scripts/acceptance/catalog.mjs`](../../scripts/acceptance/catalog.mjs)。每组列出源入口、
真实依赖、替身/前置、不覆盖事项和操作说明。它是索引，不是已通过状态表；尤其不表示正式 UI 已通过。

```sh
npm run sensa:acceptance -- list
npm run sensa:acceptance:check
npm run sensa:acceptance:smoke
npm run sensa:acceptance -- plan native-learning native-assurance native-intake
npm run sensa:acceptance -- plan reading popup
npm run sensa:acceptance -- run reading popup
```

`check` 只检查索引、源文件与操作说明存在，并要求所有原生 `*_test.dart` 有证据边界；
**不运行产品测试，不证明断言覆盖完整**。`plan` 只读。`run` 只运行明确选中的可执行组，
没有隐式全量模式、自动重试、付费 Provider 或 `.env` 自动加载。
`smoke` 在 macOS/Linux 使用合成失败命令验证运行器拒绝无效选择、记录失败和及时停止；不运行产品旅程。
浏览器可设置 `SENSA_CHROMIUM_PATH` 指向已安装测试浏览器；没有可用浏览器应修复前置条件，不能跳过后记为成功。
需要已安装仓库依赖及所选组的 Cargo/浏览器工具链。已有 smoke 可能使用已安装依赖或本机构建缓存；
首次工具链下载不等于测试调用了付费模型。

运行会在系统临时目录创建 `sensa-acceptance-*`，保存逐命令 stdout/stderr 与 report.json：
revision、dirtyFiles、平台、请求组、各步时间/退出码/日志、真实与替身依赖。失败立即退出，
不继续后续组；报告为 failed，未执行的组只出现在 requestedIds。中途强制杀进程留下 running
报告也不能视为通过。此入口不会转储环境变量或读取 owner 数据。
临时日志仍需在分享前检查内容；本次选入的 smoke 均使用合成数据。报告不上 Git。

原生组目前提供计划/准备链接，不直接自动运行：不同文件依赖不同 artifact、历史库、受控
HTTP、签名和凭据沙盒。混合选择原生组与可运行组会在任何命令启动前拒绝，防止执行一半才发现缺前置。
今后只有把某组的 fixture 建立与清理完整接入后，才给它注册自动命令。

## 原生自动化约束

1. 每次主流程使用唯一 `SENSA_NATIVE_RUN` 和合成库。先满足该用例操作说明的 fixture/服务/
   签名前置；不要通过迁移 owner 库获得测试数据。高保证必须先生成 artifact；review/activity
   是不同变体，不能从默认分支通过推导全部变体通过。
2. 被验收的动作通过真实 Widget/DOM 执行；允许直接建立前置课程和历史，但要记录。
   “加入学习”不能直接调用内核完成后只检查文案。流程结束验证持久化事实，而非仅出现成功提示。
3. 主流程与 `SENSA_NATIVE_RECOVERY=true` 以同一 run ID 在两个独立应用进程执行。
   同一进程 reload 或重建 Widget 不是冷启动。Android 保留 `--no-uninstall`；一个有副作用的
   recovery 分支不可反复当作无状态断言重跑。
4. 无账号/无 Hono、断网可用和冷恢复是独立维度：记录实际网络条件、是否存在 fixture 服务。
   “没有付费 HTTP 请求”本身不能证明网络完全关闭。
5. Flutter 集成测试与 CUA/无障碍走查串行，不同时读取同一测试窗口。macOS 隔离 Debug
   bundle/凭据沙盒，保留 owner Release 进程；不为新截图关闭用户应用。
6. 测试返回后清理自己的服务、adb reverse 和临时登记清单，恢复临时签名配置；不改变 owner
   网络偏好。不要以 indiscriminate kill/reset/delete 清理环境。

## 每轮运行节奏

| 时机 | 必要动作 |
| --- | --- |
| 小改动 | 运行受影响规则或交互测试；失败保存诊断并修复，不靠重复运行碰绿 |
| 完成纵向用例 | 主要成功/失败/恢复路径 + 持久化断言，相关语言检查；根级 typecheck/build/lint；checkpoint |
| 完成正式 UI 整组 | 最终入口的跨模块旅程，macOS/Android 各自结果、独立冷恢复，响应式和键盘检查，再实际体验走查 |
| 发布/扩平台 | 实际安装包、OS 交互、目标设备；真实网站兼容；经授权的小规模 Provider 实况。云端仍走 CI/CD |

已经通过且后续修改不影响的用例无需反复全量执行。选择依据记录在交付中；未验证的平台明确保留。
真实 Provider/TTS 测试与常规无成本回归分离，不能把旧样本质量记录当成本轮新结果。
正式 UI 的详细任务与缺口见 [验收矩阵](native-ui-acceptance-matrix.md)。

## 目录维护

证据组数量、源文件和原生测试清单由 `sensa:acceptance:check` 实查，不在文档中冻结某一轮数量。
新增/移动操作文档时同步 catalog 的准备说明引用。检查通过仅证明目录完整，不代表重跑产品测试。
历史执行日志和临时报告可从 Git 与本机测试产物追溯，不逐次追加到本页。
