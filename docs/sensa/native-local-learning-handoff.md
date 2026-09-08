# Flutter / Rust / SQLite 首个本地技术纵切

日期：2026-09-08。属于 LF-1b 的部分交付，完整 LF-1b 尚未完成。
架构和界面基线见 [ADR 0002](../adr/0002-flutter-rust-local-core.md)。

## 实现范围

- `apps/sensa_native`：无账号的 Flutter 原生验收入口，异步生成桥接调用 Rust。
- `crates/sensa-core`：轻量首学 Recall / Reveal / Again / Hard / Good 转移，以及既有固定策略的首次调度初始化；不是完整复习 FSRS 迁移。
- `crates/sensa-library`：SQLite 事务拥有命令幂等账本、Attempt、Completion、Scheduling Handoff 和 Memory 初始状态；Flutter 不计算这些结果。
- 合成材料有明确标识，只有启用 `acceptance-fixture` 才能载入。载入与加入学习是两个显式操作；不把合成材料宣称为已发布学习包或用户已接受的 Sense。
- 确认每日数量 → 载入材料 → 加入学习 → 回想/揭示/评价 → 本机保存。Again 返回回想；暂停后继续；完成首学不等于掌握。

技术壳参考正式 Web 的视觉 tokens 和已确认行为，完整首页、导航、语义世界和多端布局尚未迁移。
一般资料包导入、多目标、复习/重学、个人采集、Agent 交接、同步及导出/恢复仍是后续工作。
旧 Web/API 数据和账号未迁移，也没有双写。

## 已有验证

- `npm run sensa:native-core-smoke`：当前 TS 结算源码输出与固定 Rust 向量比对；覆盖跨年、闰日及 Hard/Good 首次调度。
- SQLite 集成：注入 Handoff 写入失败后整笔回滚；原命令重试；同操作并发只结算一次；拒绝同 ID 改载荷、陈旧版本、跨库、倒退时间、错误步骤、材料损坏及未知 schema。
- Rust clippy 严格检查、Flutter analyze、根级 typecheck/build/lint 通过。
- macOS：真实 Flutter → Rust → SQLite 集成首学通过；随后启动独立测试进程，完整投影与前次落盘回执相等，Completion/Handoff 各一份。最终复验运行标识为 `macos-20260908-b`。
- macOS Release 构建通过；原生界面实际走查确认 Recall 隐藏表达、Reveal 显示表达、Hard 完成并显示实际下次日期。
- Android：API 36 ARM64 模拟器保持飞行模式，Wi-Fi/移动数据关闭；真实 Flutter 首学与独立进程恢复两条集成命令均完整通过，最终运行标识 `android-20260908-b`。恢复比较完整持久化投影，Completion/Handoff 各一份。
- Android 工具链：SDK 36 / Build Tools 36.0.0、NDK 28.2.13676358、JDK 21、Emulator 37.1.11；Flutter doctor 的 Android toolchain 检查通过。插件额外所需 Platform 33/35 和 CMake 3.22.1 已安装。
- 实测修复：Cargokit 的 `Project.exec` 改为注入 `ExecOperations` 以支持 Gradle 9；Android 桥接编译 SDK 对齐 36，原第三方许可证保留。
- 测试工具边界：Android 必须使用 `--no-uninstall` 保留库；初次恢复检查因默认卸载清库失败，修正后重新执行首学与恢复。调试服务连接出现过瞬断/发现失败，最终使用标准 DDS 与 `-v` 两次运行通过；`--no-dds` 在当前 Flutter 中触发框架截图协议错误，不作为通过证据。没有把调试环境耗时算作产品性能验收。

测试库与回执位于应用支持目录中独立的 `local-acceptance` 路径，不是用户库。
复现实测命令见 [原生应用 README](../../apps/sensa_native/README.md)。

## 下一步

macOS 与 Android 的本轮技术纵切验收已完成。接下来按正式 Web 已确认的界面推进下一条原生用例，补齐正式资源导入与复习/重学的 Rust 本地结算，逐项关闭 LF-1b 门槛。
备份恢复与可选加密同步另行验收，当前不能宣称整库迁移或全平台产品已经完成。
