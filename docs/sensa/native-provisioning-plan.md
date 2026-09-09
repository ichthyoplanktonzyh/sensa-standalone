# 原生个人意义入学与按需材料纵切

2026-09-09，继续 Owner 确认的 Web 入学/准备/取消/显式重试/学习体验。参考 API provisioning/tasks.ts、material.ts 与 M2-C 记录，不改变 Context–Expression–Sense 或 Profile 领域规则。

入学创建本地固定目标、显式 Policy Assignment 与准备任务；生成之前不要求材料存在，也不伪造可执行目标。SQLite pending target/task 保存固定的语义身份、表达、通用原型场景、Policy/Protocol/Demand 和最多三次尝试。通过校验时将同一目标 ID 接入现有 targets 执行投影、材料表、通用 Policy Plan 和 Activity；不另建队列或调度器。

学习方式由用户在入学时明确选择，作为 target override；当前既有在线供给能力只支持 lightweight/v1 的文本需求。其他已注册 Profile 保持可选择的阻塞状态，用户可在尚未就绪时明确重新选择；不自动降级，不实现暂停中的四阶段正式材料。

Hono 原生内容服务保留 TS generateContent/reviewContent 与 makeRequest/makeBundle/validateBundle 独立校验，服务只记录请求使用元数据，不保存个人任务和候选内容。请求只含已确认抽象 Sense、目标表达和通用原型，不含个人 Context、Focus、来源 URL 或该次经历的 explanation。原文授权/撤销与音频是后续独立用例。

Rust 是任务、尝试、固定输入、候选接纳和材料冻结的权威。每次调用前先存请求；失败/取消/过期/旧尝试不能变 ready；重试显式并保持预算。返回材料必须匹配请求摘要、目标、角色、来源和独立校验结果，中文 cue 不得泄漏目标表达。命令 CAS/operation receipt 继续负责原子提交和重放。

Flutter 在个人意义详情提供加入学习/选择方式与准备状态，显示失败原因、检查本地任务、取消、显式重试；进程重启不自动调用模型。就绪后回现有学习入口，离线执行现有 Profile。验收覆盖无成本 HTTP、独立拒绝、取消迟到响应、三次预算、材料不可变、同一目标去重、双平台主流程/冷恢复、原有本机材料入学回归与根级检查。
