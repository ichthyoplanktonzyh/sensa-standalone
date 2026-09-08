# 高保证复习与重学队列生命周期

日期：2026-09-08。Owner 确认先推进高保证路径，再单独验收 Profile 到执行器的连接；后者仍是迁移完成门。

## 实现与来源

`crates/sensa-core/src/assurance_review.rs` 直接参考正式 Web 使用的
`apps/web/src/experience/engine/ReviewQueue.ts` 和 `review/types.ts`，调用已有 retention Step 选择器。
覆盖到期复习 → 反馈、失败打开重学 → 包内修复 → 独立重测，以及重测失败后的再次修复。
支持从已有重学 Cycle 开始、声明已掌握时中断、40 帧本地撤销、版本化快照与跨进程恢复。

复习的第一次结果按 due outcome identity 固定；该 receipt 不随本地撤销回退，改答案重放也不能产生第二次到期结算提案。
结果中的 memoryOutcome、focusDimension、evidenceEligible 由内核按当前步骤重新计算，不信任调用方提供的派生值。
修复不增加测评次数；重测只输出 relearning_progress，不再次为原到期复习输出 Memory Outcome。
边界能力可以作为已有重学 Cycle 的重测，但不作为自动完成到期复习的独立依据。

状态与 effect proposals 在纯内核命令中一起计算，错误命令不部分改变状态。
候选清单及目标排序由宿主固定；due outcome identity 由适配器提供，后续正式适配器须校验其与目标及到期事实的绑定。
源码中缺少可执行动作的候选会被过滤；运行后缺少修复资源可能无法产出下一步，这些行为不等于正式材料已准入。

## 验证

`sensaNativeAssuranceReviewParity.mts` 直接执行原 ReviewQueue 和实际 Web 清单，
42 组流程、820 个状态及 effect outputs 精确对照；包含空/单/多目标、不同间隔、保留第一次结果、
重复提交、修复错误提交、重测失败/成功、持久化 Cycle 起步、声明已掌握/撤销。
42 组跨进程恢复后 undo/next 与 TS 继续执行一致，8 份损坏/未知版本快照拒绝。
每个事件后分别恢复两端快照并检查状态；额外断言修复不计测评、重学不产生 Memory Outcome。
已加入 `sensa:native-core-smoke`。
完整 native-core-smoke、Rust Clippy `--workspace --all-targets --locked -- -D warnings`、
原生桥 `cargo check --locked`、根级 typecheck/build/lint 均通过；没有付费调用、用户数据迁移、推送或部署。

## 当前边界与下一步

高保证首学和复习/重学的纯队列现已具备源码行为对照，但**高保证原生路径尚未推完**。
本轮不改 SQLite schema 或 Flutter，高保证入口仍 blocked。
这些 effect 是事务输入提案，不是已持久化的 Evidence、Memory Outcome 或 FSRS 更新。
尤其重学 effects 在本地撤销重放时可再次出现；正式适配器必须提供操作身份与幂等事务，不能直接当作外部回调写库。
快照验证事件历史一致性，不证明答案/材料可信，也不承担正式同步；历史大小限制仍待生产持久化设计。

接下来接结构化材料/Action 与可信评价合同、原生事务和恢复，再接正式 Web 对应 Flutter 交互。
高保证路径贯通之后，按完整性清单专门验收 Profile 的策略绑定真正被执行器消费，不能以当前专用队列对照代替。
四阶段仍仅保留内核扩展性证据，正式材料/UI 暂停。
