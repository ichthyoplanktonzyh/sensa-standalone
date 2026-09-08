# 高保证首学队列生命周期迁移

日期：2026-09-08。延续高保证优先；四阶段正式材料/UI 仍暂停。

## 已完成范围

`crates/sensa-core/src/assurance_queue.rs` 直接对照正式 Web 使用的
`apps/web/src/experience/engine/LearnQueue.ts`，承接上一轮 Step 选择器及通用 Progression。
迁移 Introduction → Gate 测评 → 定向修复 → 重测 → 毕业的队列状态转换，
以及学习者纠错、Declared Mastery、跳过、40 帧撤销和版本化快照恢复。

- 首字母提示、选择辅助和未回想成功均不算独立 Recall 通过。
- 修复完成只更新修复与协议状态，不增加测评次数/正确次数，仍须重测。
- 失败只重置当前 Checkpoint，保留其他已通过 credit。
- 标记已掌握只改变队列排程资格，不写毕业、Evidence 或 Memory Outcome。
- 已结算步骤不能再次计数；学习者纠错遵循原 Web 规则，不回减先前正确次数。
- 错误命令不部分提交。撤销只恢复本队列状态，不撤销 SQLite 学习历史或 FSRS。
- 快照固定清单、Run 身份、开始时间、排序和事件序列；恢复时重新执行内核事件，
  校验最终状态及撤销帧。不同进程可继续学习和撤销，未知版本或状态/历史不一致会拒绝。

原 Web 的 localeCompare 顺序由宿主显式提供并随快照固定；没有引入 Rust 默认字节排序。
Package 仅携带身份及可执行清单，呈现内容不复制到每一个历史 Session。

## 验证

`scripts/sensaNativeAssuranceQueueParity.mts` 直接执行原 LearnQueue 与实际 Web 材料清单，
覆盖空队列、单/多目标、不同间隔、独立/辅助回想、失败修复、纠错、跳过/取消已掌握、
重复提交、撤销与恢复。24 组流程、774 个状态精确一致；24 组跨进程继续/撤销一致；
8 份损坏或版本不支持的快照被拒绝。每次事件后也验证两端各自恢复的一致性。
另外断言成功路径完整毕业，以及辅助回想、修复和已掌握的关键不变量。
该差分加入 `sensa:native-core-smoke`。
完整 native-core-smoke（含 Rust workspace 回归）、Clippy `--workspace --all-targets --locked -- -D warnings`、
原生桥 `cargo check --locked` 和根级 `npm run typecheck` / `npm run build` / `npm run lint` 均通过。
本轮没有付费调用、用户数据迁移、推送、部署或 Flutter 平台验收。

## 边界与下一步

这是一项内部内核迁移，**不是高保证产品入口验收**。原生高保证入口仍 blocked。
输入是已经评价后的结果，真实答案判定、帮助条件的可信绑定和材料准入仍待适配。
为与原 Web 状态对照保留的合成 Evidence ID 不是生产 Evidence；不得写入正式学习结算。
快照事件重放验证内部一致性，不证明输入可信，也不是旧 TS checkpoint 导入器或同步协议。
事件历史仍随会话增长；生产持久化接入时需要明确大小限制和压缩边界。

本轮不变更 SQLite schema、已有用户数据、Flutter UI 或调度事务。
下一步迁移高保证 ReviewQueue／relearning 生命周期，随后接入结构化材料、可信评价、
幂等本地事务与正式 Flutter 高保证交互，完成离线端到端验收。LF-1b 仍未整体完成，
M3 后续计划继续保留。
