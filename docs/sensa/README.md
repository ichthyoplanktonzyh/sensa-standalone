# Sensa 文档索引

本索引区分领域、品牌与设计、产品和工程事实。项目进度、阶段总结、部署记录和临时问题不属于长期文档。

## 领域模型

以下七份文档共同定义 Sensa 的领域语言、对象、边界和不变量，产品与工程文档不能覆盖它们：

| 文档 | 职责 |
| --- | --- |
| [`../../CONTEXT.md`](../../CONTEXT.md) | 统一语言与产品边界 |
| [`production-architecture.md`](production-architecture.md) | 领域总图、聚合、多语言上下文与全局边界 |
| [`personal-semantic-world-model.md`](personal-semantic-world-model.md) | Context–Expression–Sense、Personal Meaning 与多语言 Expression Anchor |
| [`learning-connection-model.md`](learning-connection-model.md) | Language Learning Route、学习入口、目标、策略、内容来源与调度交接 |
| [`semantic-acquisition-model.md`](semantic-acquisition-model.md) | Structured Acquisition 与能力诊断 |
| [`sense-learning-resource-model.md`](sense-learning-resource-model.md) | 学习资源、Materialization 与发布语义 |
| [`learning-runtime-model.md`](learning-runtime-model.md) | 学习运行、Pinned Language Context、证据、进度、账号与数据控制 |

发生冲突时先以 `CONTEXT.md` 确认术语，再由职责最接近的领域文档裁决。实现结构、页面顺序、测试命令和发布配置不进入领域文档。

## 品牌与设计

- [`brand-foundation.md`](brand-foundation.md)：Sensa 为什么存在、核心品牌命题、公共 Sense 与个人经验的品牌表达边界。
- [`../../DESIGN.md`](../../DESIGN.md)：当前 Web 语义设计合同、Skin 呈现体系与可执行设计约束。

品牌文档解释领域背后的人本动机，但不能覆盖领域身份或不变量。`DESIGN.md` 中的具体 Skin 方向也不自动成为 Sensa 的品牌身份。

## 当前产品与工程

- [`product-requirements-v1.md`](product-requirements-v1.md)：当前 Web 产品范围、页面职责、主要旅程和用户可见状态。
- [`user-journeys.md`](user-journeys.md)：跨 Web、浏览器扩展、Agent、学习包与学习运行时的端到端用户旅程。
- [`engineering.md`](engineering.md)：当前代码边界、本地开发、数据同步、验证与生产发布方式。
- [`support-recovery.md`](support-recovery.md)：已发布 Web 的支持受理、数据保护、恢复顺序与事故演练操作。

这些文档只维护当前有效内容，不追加施工日志。完成记录由 Git 和 CI 保存，待办由 issue tracking 保存。

## 就近操作说明

- [`../../apps/web/README.md`](../../apps/web/README.md)：Web 开发与媒体准备。
- [`../../apps/browser-extension/README.md`](../../apps/browser-extension/README.md)：扩展构建与本机加载。
- [`../../content/README.md`](../../content/README.md)：内容工具和外部调用边界。
- [`../../infra/README.md`](../../infra/README.md)：生产基础设施入口。

`docs/reference/` 中的原型和媒体只用于视觉或行为对照，不定义产品、领域或完成状态。
