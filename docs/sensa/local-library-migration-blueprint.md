# 本地学习库迁移蓝图

> 日期：2026-09-08；当前施工设计，受 ADR 0001 与七份领域文档约束。
> Owner 已同意开始本地底座阶段。本文固定执行顺序与模块职责；不代表整库离线、Flutter 或加密同步已交付。
> 阶段进度只由 [current-stage](current-stage.md) 与[路线图](production-migration-plan.md)维护。

## 1. 本轮起点与用户结果

已确认方向是：个人资料属于完整本地学习库，同步可选，服务器可保存端到端加密副本。
已有 M1/M2 测试是在本机运行 API/Postgres；客户端仍依赖 Account 初始化、服务器离线授权和服务端结算。
它们是迁移回归资产，不是独立学习库证据。

第一条产品纵切复用已确认的轻量首学、复习、重学界面：选择本地已有合格材料 → 显式加入学习 →
开始/继续学习 → 本机结算 → 重启继续 → 到期复习。它不要求登录 Sensa 账号、购买同步或调用模型。
导入/下载材料仍不等于加入学习；Sense 接受仍不自动入学；关注点仍可选。

工程顺序已由 Owner 确认的 [Flutter/Rust 决策](../adr/0002-flutter-rust-local-core.md)更新：先做 Flutter → Rust → SQLite 原生纵切；正式 Web 提供界面/行为与 TS 对照，共用内核不依赖浏览器、HTTP 或数据库。
Owner 已明确完整产品的 PC/移动主应用由 Flutter 实现；React Web 的阶段性验证不替代这一终局。
这不提前确认 Web 是完整本地产品的最终首发宿主：浏览器存储持久性、离线启动和扩展交接需要实际验收。
Flutter 调用 Rust 的方向已确定；平台交付资格逐项实测，不能沿用“复制服务端投影即可”。
`web-next` 仅作为行为/场景参考，不迁入原型 fixture 状态或另外造一套学习界面。

## 2. 从实际代码到目标模块

| 当前代码 | 可复用部分 | 必须改变的职责 |
| --- | --- | --- |
| `packages/learning-kernel/src/runtime/consumerInitial.ts`、`scheduling.ts` | 版本化步骤转移、FSRS 算法 | 保持平台无关；不得混入登录、网络、存储 |
| `apps/api/src/sensa/runtime/initial.ts`、`retention.ts` | 既有轻量协议结算行为与事务回归 | 结算决策移到 Kernel；SQL、权限、操作账本继续由旧适配器负责 |
| `apps/web/src/data/replica/accountStore.ts`、`initialRuntime.ts` | IndexedDB 原子读写经验与界面消费形状 | AccountReplica/outbox 不能直接改名为库；离线 grant 和 pending_result 不适用于本地已提交事实 |
| `apps/web/src/experience/account/` | 已确认首页、学习、完成/复习呈现 | 通过应用层读取 Library，不从组件直接写结果；账号变成在线服务入口 |
| `packages/contracts/src/sensa/`、`packages/content-validator` | 固定 Target、Materialization、内容校验合同 | 本地命令独立于 Sync v3 envelope；保留身份/版本，不套入虚构账号 |
| `apps/api/src/sensa/personal/`、`curriculum/` | 接受、入学、内容审核的不变量 | 逐条拆出本地语义接受/入学，在线模型返回候选，不能直接提交个人事实 |
| `apps/browser-extension` | 采集、解释、YouTube、恢复队列体验 | 交接绑定 libraryId；原账号队列必须经过明确迁移，不能自动改投新库 |

目标依赖：

```text
React / Flutter / 浏览器采集交接
                  ↓ 用户命令
       Library Application（校验、幂等、事务）
           ↓                     ↓
      Domain Kernel         Library Store
    语义/协议/结算规则       IndexedDB / SQLite
           ↑                     ↓ 已提交事实
    固定材料与策略          Sync Agent → 加密传输

资源下载、模型请求 → 校验/固定候选 → 显式本地命令
账号/计费服务只授予在线服务访问，不授予本地学习资格
```

本轮实际新文件是 `packages/learning-kernel/src/runtime/consumerSettlement.ts`，由原 API 消费。
后续本地用例在 `crates/sensa-core`、`crates/sensa-library` 与 `apps/sensa_native` 施工；Web 保留成果并暂停新建设，不新增浏览器本地库作为当前前置任务。
语言无关输入/输出在该用例形成时加入 contracts；Kernel 不反向依赖 contracts，避免现有包依赖环。
Flutter 使用 Rust 共享可执行内核，桥接选型和行为验证见 ADR 0002。Rust 分离纯领域与本地存储模块；
TS 测试向量用于一致性对照，Web WASM 暂不施工，不新增 Dart 领域规则副本。

## 3. 库身份与事务所有权

- `libraryId` 是个人学习库身份，创建不要求 Account；`learnerId` 在库内稳定。
  `deviceId` 与一次安装/设备授权关联，账号绑定是可选服务关系。首次本地使用不伪造云端身份。
- 数据库按库隔离；本地学习库与旧 AccountReplica 使用不同命名空间，禁止同时对同一学习历史双写。
- 命令具有 `operationId`、库身份、已知版本和明确用户意图。应用模块负责校验；UI 不提交 Completion、
  Evidence、FSRS State 或“已掌握”派生值。
- 同一操作 id + 同一规范化输入返回原结果；同 id + 不同输入拒绝。陈旧步骤/版本返回冲突，不覆盖。
- 一个存储事务包含操作账本、Attempt、Transition、Completion、Handoff/Outcome、Memory revision 和
  可同步事实。事务成功才呈现“已保存到本机”；同步成功与否不改变该结果。
- IndexedDB 的 read-modify-write 在一个事务内完成，以事务串行化处理多标签页。网络、模型、文件读取
  和异步 digest 不放进活动事务；先准备输入，再在事务中重查版本。SQLite 同样需要原子事务和唯一约束。
- 累积事实按独立对象/索引保存，不继续把整库历史塞进单个 AccountReplica JSON。批量下载先暂存校验，
  以版本清单原子发布；失败不生成半个 ready Target。
- 本机时间不再依赖服务器 grant；保存时间来源和原始时间。时钟倒退不得回写旧的 FSRS 时间，向前大跳
  的状态/校准体验在本地用例中细化。不能把服务器重放时间作为离线学习发生时间。

## 4. 最小消费合同与体验状态

以下是下一纵切的命令职责，不是已经发布的 wire schema：

| 意图 | 前置与结果 | 失败/恢复 |
| --- | --- | --- |
| 创建/打开库 | 无账号创建身份或恢复同一个库；每日新学数量仍需明确确认 | 不支持的版本、存储不可用不得回落为临时成功 |
| 导入固定资源 | 校验 schema、版本、digest、Target/Binding/角色覆盖与可信发布来源；原子保留内容 | 损坏、不支持的协议、必要内容缺失显示原因；导入不自动产生学习事实 |
| 加入学习 | 固定目标、入口 provenance、策略/plan；同连接去重 | 已加入返回既有目标；材料未就绪不能开始 |
| 开始/继续 | 本地选择已有 ready 目标，冻结 Policy/Run/Materialization；遵守数量和模式 | 暂无到期、今日额度、等待重学分别呈现；不要求联网 grant |
| 回答/暂停/结束 | 校验固定 Step 与版本，本机事务提交，再更新界面 | 保存失败保留当前题与可重试意图；重复提交不二次结算 |
| 重启继续 | 恢复库、同 Run、固定材料、下一次复习时间 | 必要材料缺失阻止本 Run；可选音频缺失允许文本回退 |

已确认的 Recall/Reveal、again/hard/good、数量与学习结果界面继续复用。
“本机已保存”和“同步未开启/待同步/失败”是独立状态；本地结算不再显示“等待服务器确认结果”。
本地库创建、资源导入/备份、存储配额失败及退出账号保留库等新增界面尚需给 owner 展示具体状态，
不能把本蓝图当作全部新增页面已验收。基础内核提取不改现有用户界面。

浏览器宿主验收还必须包含：应用外壳和必要资源缓存、关闭进程后断网冷启动、持久存储申请/状态、
配额失败，以及独立导出/恢复。仅在已打开页面设 offline 不能证明断网重启可用；浏览器缓存也不是备份。

## 5. 浏览器采集交接

插件继续负责这个采集端口，保存所需内容仍是 Context、Sense、Expression；Focus 是可选桥梁。
接收方是明确选定的本地库。传递固定 Capture/Proposal 与原 operationId，接收端校验并本地提交，
返回持久化回执后插件才标记交接完成；超时保持结果未知并用原 id 重试。

接收方未运行时，插件保留采集队列并明确“尚未交接”，不得把内容暂存在 Sensa 明文服务端来绕过限制。
对 Web 的候选实现是限定 origin 的显式握手与消息交接；对桌面可评估原生桥接。需验证发送来源、
库授权、窗口生命周期、重复/跨库消息及账号解绑后队列归属，再确定传输实现。
收到 Proposal 不是 Acceptance；没有 Sense 的原文可进入待处理收件箱，不显示为完整 Personal Meaning。
旧插件仍走旧 API，待新交接验收后切换；当前浏览器体验优化清单继续暂停。

## 6. 同步、备份与在线服务

同步以已提交的个人事实和附件为输入，账号认证在同步适配器；本地应用不调用 Sync 才能结算。
同库多设备不是复制整个数据库：首次 Handoff 去重、同一 due identity 的并发 Review、重复源的 Target
身份、笔记冲突和删除恢复都需要明确合并规则。保留每次原始作答；不能把两份同次 due 评价都调度，
也不能凭最后写入覆盖另一份学习历史。

在多设备施工前，以共同基线/因果依赖与稳定事件身份定义可重放顺序、有效调度选择和冲突呈现。
2026-09-09 已确认事实/版本/投影模型与分层验证，见 [事实模型蓝图](personal-library-fact-model.md)；有界 G0 冲突分类实验通过，完整学习分支裁决仍未选定，单设备完成不等于调度收敛。同步协议、算法版本、缺失依赖和未知版本恢复
必须通过乱序、重复、断点和多设备离线向量后才能启用。

密钥设计门：设备生成库密钥、设备包裹/授权、新设备加入、独立恢复凭据、丢失/撤销/轮换、附件加密、
元数据最小化。服务器不持有恢复明文所需秘密；撤销不承诺删除已解密副本。采用维护中的加密实现，
具体套件和恢复 UI 在同步施工前审定，不在本次自行发明加密协议。

公共资源目录只发布可下载的版本化资源。模型解释/生成只按一次请求传递必要输入，返回候选和校验
信息，由本地完成保存；不能借任务日志长期保留完整私有库。BYOK 凭据、托管请求的留存/删除和
迟到结果处理另设明确合同。E2EE 不覆盖用户主动发送给模型的明文输入。

本地导出/备份保留对象身份、版本、必要材料/附件和校验清单；恢复先暂存校验再启用。
云端副本删除、账号解绑、退出、删除本地库分成不同意图。停止同步服务不删除本地内容或历史。

## 7. 旧数据迁移与回退

1. 只读盘点旧 Account/Learner、材料、Run、Outcome、调度与未提交 outbox，记录数量/摘要/版本。
2. 确定源快照水位及待提交意图处理；开始切换后暂停旧链写入，保留完整源备份，禁止双写。
3. 导入隔离库，保留原 identity/provenance/时间。先核对引用和唯一性，再验证可继续的 Runtime。
   无法重放的旧版本以可审计导入记录保留，不伪造行为 Evidence 或新 Initial Handoff。
4. 验证记录数量、引用、材料 digest、目标/历史/下一次复习；通过后切换接收方。
5. 导入失败继续旧链；切换后若已有新本地事实，不能简单恢复旧快照丢掉它们，须导出增量或修复迁移。

本轮没有读取/迁移 owner 学习数据、删除旧库或改变在线账号。隔离测试库不代表历史迁移验收。

## 8. 本轮结算提取合同

`decideConsumerSettlement` 输入固定 Purpose/Protocol、目标、Reveal rating、发生时间；Review 另外输入
当前 Memory 与 Run 固定的 due/revision。输出纯决策，包含现有 policy 的以下效果：

- Initial again 继续；hard/good 产生非证据性的 Study Completion + protocol_completion Handoff，
  沿用固定 good 初始化 FSRS，不能把 initial hard 当作 due Review hard。
- Review 校验同一 due/revision、目标与时间；产生 self_report / learner_rated 的 Outcome 与新 schedule；
  again 附带 10 分钟后的重学资格。
- Relearning again 等待，hard/good 完成；不产生新的 FSRS 更新。

模块不生成数据库 id，不访问账号/IO，不负责幂等账本，也不证明输入 Step 已合法提交。
调用方仍需验证材料、当前 Step、版本及授权，并在一个事务提交 Attempt、Transition 和所有结算效果。
因此纯函数重复运行相同结果只证明确定性，不等于重复操作已幂等落库。

无成本验证包括 Node/断网 Chrome 一致向量、错误 due/时间/协议拒绝，以及隔离 Postgres 原有首学、
复习、重学、重复提交和事务故障回归。当前 API 是实际消费者；本地存储接入与产品离线验收仍是下一纵切。
