# M1-D：到期复习与重学交付记录

> 2026-09-08；本地端到端纵切，真实 Supabase 托管验收待执行。

首页“只复习”只进入到期复习及其重学；Mixed 保留首学继续与新学。
复习回想、揭示后只评价一次：again/hard/good 原值形成 learner_rated、自报等级的
Memory Outcome，并在同一事务更新一次 FSRS。again 同时建立 10 分钟后的重学需要。

等待期间可以继续其他目标；只有等待项时显示“稍后还有 N 个需要再回想”，可以结束本次
或主动提前。再次遗忘重新安排 10 分钟，刷新不重计；恢复同一个重学 Run。
重学成功只形成 Relearning Completion，不把原 again 改为 good，也不再次改动复习时间。
汇总按目标去重，区分首学、原复习、已恢复、仍需回想和其中的等待项；本机未确认单列。

## 实现

- migration 0014 扩展 C 的 Run/Completion，增加 due revision 唯一约束、Memory Outcome、
  Relearning Need、Outcome→SchedulingDecision，并保留一 target 一 active Run。
- `runtime/retention.ts` 拥有到期资格、重学等待与恢复、purpose 专属材料快照及复习结算。
  原子操作继续使用 learner 锁、固定 Step、原始回答、feed 与结果账本。
- 初学材料中经验证的回想/揭示资源可以明确复用到固定轻量 Review/Relearning，建立独立
  purpose Materialization 与来源引用；不覆盖原快照，不需要重新调用模型或 TTS。
- `consumer-review-v1` 与 `consumer-relearning-v1` 固定协议版本；原 `consumer-initial-v1`
  和 Step ID 不变。等待中的 Run 不提供可作答 Step，须在线到时/主动提前授权后再进入。
- Activity 模式创建后固定；跨模式暂停原活动，保留 Run。Review-only 不恢复未完成首学。
  成果按 Completion 当时的活动归属记录，重新引用 Run 不搬动旧活动的已确认数量。
- 冲突答案仍保留，检查结果发现新冲突时先显示核对状态，只有用户明确选择最新进度才继续。

## 验证

`npm run sensa:consumer-retention-smoke` 和同脚本 Deno 执行通过：包含 A/B/C 既有回归、
到期身份、模式隔离、独立材料、两安装并发、SchedulingDecision 注入故障全回滚、
原评价/唯一调度、4 分钟仍等待、结束后重新进入、主动提前、再次遗忘重排、到时恢复、
重学不改 Memory State、下一次到期独立评价，以及旧活动汇总与私人读取边界。

生产构建 Chromium 流程覆盖首学→两天后复习→遗忘→等待→结束/再次进入→提前重学→
再次等待→刷新→到时恢复→汇总。测试时间通过独立本地 harness 的时钟偏移推进，
不会修改实际账号的调度；测试 API 未被生产应用引用。
浏览器仍为 Chrome for Testing 149.0.7827.55，390×844 / 1280×800，素材复用 C 的已有样本。

根级 typecheck、配置了合成登录服务的生产 build、lint、Edge check、原轻量 Runtime 与
Sync 协议 smoke 通过。数据库在隔离的 C 基线上增量应用 0014。
常规检查没有模型或 TTS 调用；CI 已扩展到 D，但不宣称远程 CI 或托管环境已经验收。

## 边界

D 本地完成，下一条直接实施 E：独立签到、自动进入触发、离线与账号恢复总验收。
原 C 的有界快照、应用壳离线冷启动、CSS 预算与公网性能缺口继续有效。
正式 Web 入口加 AccountRoot gzip 约 245 kB，CSS 119.66 kB；本次没有性能达标结论。
