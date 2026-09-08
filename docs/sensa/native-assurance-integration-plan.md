# 原生高保证路径接入施工记录

2026-09-08，Owner 授权持续推进到完整路径及 Profile 执行连接验收，不在内部检查点停止交付。
本记录不是完成声明。

## 当前施工顺序

1. 按正式 Web 的安装合同迁移 runtime release 准入、固定任务/资源解析、答案与辅助状态判定。
2. 在原本地库追加高保证会话、原始回答/草稿、Evidence 与队列恢复，复用目标、Policy commitment、Memory 和 operation/CAS 权威。
3. 将首学毕业、一次到期复习结算和重学进展接到原子本地事务；不允许 UI 提交 correct/Outcome/credit。
4. 参考 apps/web 的 AssuranceCard 和反馈/摘要，接 Flutter 桌面/移动交互与离线恢复；保持帮助、资源回退、失败与重试状态。
5. 验收 Profile → 固定 plan → 注册执行器/策略 → 事务/呈现的实际连接。不同组合真正改变执行行为，未知组合阻塞，已有 Run 不被配置修改。

## 边界

- runtime release 是发布流水线已产出的交付物，不是 LLM 候选包。准入不替代上游治理，也不自动入学。
- release/材料按规范化内容固定 digest；运行只解析当前 Action 的 taskKey、包/Sense 及能力，不能任意换题。
- 辅助状态必须在 Rust encounter 中持久化，原始回答不能自行声明独立成功。
- 学习事实和 effect/Memory 的提交必须与会话状态、操作回执同事务；错误、重复、断电不部分更新。
- 首学临时撤销与复习本地撤销不得删除既有 Evidence 历史或撤销已提交 Memory Outcome；跨提交边界要显式处理。
- 现有轻量库和历史保留；新的高保证路径不能借轻量完成标识冒充高保证毕业。
- 核心 schema 与交叉引用校验必须对照 TS。平台构建不等于真实交互、媒体及恢复验收。

2026-09-09：本施工顺序已推进至完整纵切与 Profile 执行接线验收，结果、证据和剩余产品边界见 [交付记录](native-assurance-integration-handoff.md)。
