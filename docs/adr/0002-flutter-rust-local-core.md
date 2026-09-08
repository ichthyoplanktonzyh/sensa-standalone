---
status: accepted
date: 2026-09-08
---

# Flutter/Dart 主应用、Rust 本地核心与 TypeScript 浏览器/云端

Owner 已确认完整产品以三种主要语言协作，并授权开始实施；本轮另明确安装 Android SDK 一起验收。
本决策落实 ADR 0001 的本地执行方案，不改变领域规则或宣称现有 TS 功能已全部迁移。

同日 owner 在讨论复用现有 TS 核心和 Obsidian 路线后，再次明确“还是直接上 Rust”。
保持 Flutter 原生 PC/移动应用与 Rust 本地核心；不继续实施嵌入 JS 运行时的替代试验。
迁移按用例进行，以既有 TS 规则和回归作为对照，不将 Hono 云服务整体重写。

## 分工

- Flutter/Dart：PC 和移动主应用的界面、交互、系统集成与领域命令调用。
- Rust：平台无关领域决策；本地库应用事务、幂等账本与 SQLite/附件管理。界面不得另算学习结果。
- TypeScript：浏览器插件、React Web 和 Hono 云端的在线模型、资源、同步接口与账号/用量。
- 需要 Web 执行的领域逻辑可通过 Rust WASM 复用；WASM 的存储/运行限制需单独验证，本次未实现。
- 同步合并的职责归本地核心；同步服务器不依赖个人明文来裁决学习事实。具体协议与 E2EE 仍待设计。

Flutter 原生主应用不再以嵌入 JS 引擎为默认内核方案。现有 TS Kernel 保留为迁移对照和旧 API 消费者，
按切片验证后替换，不并行发展两套相同规则。Hono 无需整体重写成 Rust。

## 首个技术纵切

`crates/sensa-core` 提供无 IO 的领域决策，`crates/sensa-library` 拥有 SQLite 应用事务，
`apps/sensa_native` 通过 flutter_rust_bridge 调用本地库。桥接胶水由固定版本工具生成，
不手工维护内存所有权或 FFI 编解码。初始选用 2.12.0；升级须同 Rust/Dart 依赖和生成工具一起验证。

本轮只验证轻量首学和其首次 Scheduling Handoff。固定合成材料通过显式验收 feature 开放，
不称为正式资源发布、完整包导入、已确认的个人 Sense 或全部产品客户端。
复习/重学的 Rust 实现、其他 Policy、多目标规划、采集/Agent 交接、加密同步与旧数据迁移均后续施工。

验收入口无账号：确认数量 → 载入验收材料 → 显式加入学习 → Recall/Reveal/rating →
Rust 原子 Completion/Handoff/Memory → 独立进程重启保留结果。
首学规则和调度输出对照现有 TS；SQLite 验证重复/并发、事务故障、跨库拒绝和损坏/未知版本。

## 界面基线

Owner 明确 Flutter 界面应参考复刻正式 Web 已确认的部分。复用信息层级、视觉 tokens、文案和行为，
用 Flutter 组件适配桌面与移动设备。`web-next` 实验页面不是正式界面基线。
当前验收壳仅用于验证首学与恢复，不代表完整首页、导航、我的语义世界或全站 UI 已迁移。
