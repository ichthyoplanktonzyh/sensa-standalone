# M2-C：个人意义入学与持久内容准备

> 2026-09-08；本地文本内容纵切。前序 checkpoint `61ee312a`。

已确认的个人意义经显式“加入学习”进入同一 Target/Runtime。私人 admission 输入有 learner
隔离，不出现在公开目录，也不冒充 reviewed/published。加入只创建目标和待准备任务，不开始
学习。Web 提供准备、检查原任务、取消和有预算的显式重试；准备成功后回首页开始 M1 首学。

Task 固定 Target、Policy/Protocol、完整 Demand 与语义来源；每个 Attempt 最多一次生成，
提交不可变 Bundle 后结束。独立模型校验与确定性 schema/角色/摘要校验均通过，才冻结
Materialization 并标记 ready。数据库保护 Task 输入、Attempt 请求及已提交 Bundle/validation。
生成只接收确认后的抽象意思、目标表达及通用场景，不默认授权或传递原网页全文。
每任务最多三次显式尝试；重复检查不重复生成或制造同步变化。取消、超时、撤销校验在事务
边界重新检查，迟到响应不能覆盖当前任务。没有后台无限重试。

## 验证证据

- 新建隔离 Postgres `sensa_m1a_m2_c`：0001–0018 全量事务迁移及确定性 fixture 通过。
- Node：M1 A–E、Intake、Semantic、Provisioning 全部通过。
- Deno：基础账号/目标、Intake、Semantic、Provisioning 通过；Edge check 通过。
- 故障矩阵：独立拒绝、provider 失败、三次预算、快照不可变、并发检查、取消后迟到结果、
  路由实例重建、校验 lease 超时后显式恢复，均有无成本 Postgres 集成验证。
  路由重建证明无进程内任务状态依赖；尚未以真实 kill/restart 覆盖所有托管中断形态。
- 实际 MV3/Chromium 插件：授权、快慢两轨、离线保存/浏览器重启、Meaning 深链、显式入学、
  准备/页面重载、M1 首学完成及调度交接。截图 `/tmp/sensa-m2-personal-recall.png`、
  `/tmp/sensa-m2-personal-completion.png`；完成页已视觉检查。
- 正式 Web M1 A–E 浏览器回归通过，含离线回答、丢失完成响应、复习/重学、签到与账号隔离。
- 根级 typecheck、production 模式 build、lint 通过。CI 配置增加无成本 provisioning 检查；
  远程 CI 未执行。web-next 既有大 bundle 警告仍存在。

## 单列真实 DeepSeek 试验

Owner 明确授权后，固定非敏感句子 “She gave tactful feedback on the proposal.”，选择 tactful，
执行语义解释、内容生成和独立校验三次调用。实际返回 `deepseek-v4-flash`，分别耗时
5331/2086/1842 ms，总 token 5791（输入 5278，输出 513）；最终角色覆盖/摘要校验通过。
生成提示为具体中文反馈场景，未回显英文目标，私人 URL/来源未进入生成请求。
结果仅保留 `/tmp/sensa-m2-real-deepseek-result.json` 和 usage 文件；没有凭据或生成数据入 Git。
这是单样本连通性与初步质量证据，不等于完整语义质量/隐私或成本验收。
适配器随后修正为记录 provider 实际模型名及生成 token usage；这项由常规静态检查验证，
没有为了验证审计字段追加付费调用。

## 剩余范围

Personal Anchor 显式授权、撤销/删除后的使用限制；按需静态音频及资源失败分级；更多真实
质量/隐私样本；Web 澄清/重新解释/误收移除；插件原生 activeTab、权限/账号/版本/更新矩阵。
本测试额外授予 fixture origin，不能冒充原生 activeTab 验收。托管服务、商店分发、公网及
真实进程中断矩阵仍缺证据。M2 全阶段尚未验收。
