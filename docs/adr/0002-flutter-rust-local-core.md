---
status: paused
---

# Flutter/Dart 主应用、Rust 本地核心与 TypeScript 浏览器/云端

本 ADR 保留领域架构文档所引用的原生职责边界：Flutter/Dart 承担原生界面与平台集成，Rust 承担原生本地领域事务，TypeScript 承担 Web、浏览器扩展和在线服务。

原生实施当前暂停。本决定不构成原生迁移计划、测试门或 Web 发布前置，也不要求当前 Web 改写为 Rust/WASM。恢复原生工作前需要重新确认产品范围和执行方案。

当前执行范围见 [`docs/sensa/engineering.md`](../sensa/engineering.md)。
