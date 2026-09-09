# 原生日常学习组织施工范围

2026-09-09。Owner 已授权持续完成下一步，不在内部检查点暂停。
沿用已确认 apps/web 首页、正式 Runtime、学习总结和“我的学习”签到行为。
本轮为已有轻量/高保证执行器增加用户活动容器，不重新实现判题或排程。

- `activity.rs` / schema v7：固定活动目标范围、mixed/review_only、开始/继续/暂停/结束、运行引用和结果归属。
- `activity_results` 只接纳已提交的 completion；同一结果只能属于一次活动，统计按 target 集合去重。
- CheckIn 为独立命令；formal 引用当前活动的进入操作，Flutter 确实显示可回答界面后再发出。
  手动与 formal 按本机发生日期唯一，不产生 Evidence 或排程；失败不阻止学习。
- 每日额度按领域 Introduction 接受边界计数；Run 准入预留单独计算，并与协议内部穿插数量分离。旧版准入记录保留来源，不伪造历史 Introduction。
- 既有内容、语义世界、同步与上游 LLM 不属于本轮新增功能；其范围仍保留在迁移清单。

执行依据：`apps/api/src/sensa/runtime/initial.ts`、`retention.ts`、`activity/checkin.ts`、
`apps/web/src/data/replica/initialRuntime.ts` / `checkin.ts` 与领域 Learning Session / Unified Planning。
迁移后的时间和权威是本机 SQLite；不移植旧在线登录、grant 或服务器时钟前置。

验收覆盖：只复习不引入/推进首学；暂停/跨模式恢复；范围固定；waiting 不伪装到期；
多次复习/修复的目标去重；重复/非法命令回滚；独立签到日期及第一来源保留；macOS/Android 真实交互和冷启动。
