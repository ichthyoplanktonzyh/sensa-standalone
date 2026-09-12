# 迁移期 Consumer 兼容参考

本文保留旧 Account/API/Postgres/Sync v3 路径的兼容约束和回归入口，替代 M1/M2 的逐切交接报告。
它不定义正式 Web 本机学习的权威，也不覆盖 ADR 0001–0003 或七份领域模型。旧数据不能静默
迁移或用新协议重解释；本机路径见 [Web 工作流](web-local-meaning-workflow.md)。

## 兼容边界

- 旧 Sync v1/v2、consumer v3 及本机库分别保留身份、版本和账本；未知版本拒绝且保留输入。
- Consumer 的账号准入、安装/replica/epoch、operationId、revision、材料授权与时钟均须验证。
  原操作重放返回原结果；同 ID 改载荷拒绝。冲突保留原回答，不自动套用新 Step。
- Attempt、Transition、Completion/Outcome、SchedulingDecision、投影/feed 与操作结果同事务；
  故障全部回滚。首学初始化一次，每个 due identity 一次复习 Outcome；轻量重学不重评原复习。
- `decideConsumerSettlement` 是 API 与本地适配器共用的纯决定入口，FSRS 配置按版本固定。
  事务、授权与持久化由各自适配器承担；Node/断网 Chrome 相同向量不证明完整应用离线。
- 旧 bootstrap 采用最多 500 项的有界完整快照；超限拒绝且保留旧副本。完整分页与旧数据迁移
  仍需专门设计，不能从后来的 Web 本机库恢复能力反推旧 API 已支持。
- `0001_sensa_baseline.sql` 中 org workspace/settings 与 `/me` 字段是兼容 seam，非产品 Workspace。
  业务 schema、角色授权以版本化迁移为准，不因移除阶段报告删除旧表或历史。

## 原始回答与时钟

C05/C07 增加必填 `clockSessionId`；C06 增加 `clock:{sessionId,elapsedMs}`，本切片在线和
离线回答均使用非空 Grant。Grant 绑定 learner、安装、replica、epoch、Run、协议、材料、
baseRevision 和页面时钟会话，有效期 7 天。C05/C07 响应以当前服务器时间建立单调时钟基准；
重放旧响应不会重新开始授权有效期。刷新后旧时钟基准不复用，需联网恢复获取新授权。墙钟与单调时钟明显偏离时也要求重新校准，
墙钟只用作漂移探测，不直接作为回答的权威时间。

服务器检查发生时间与校准时间、授权有效期、单调顺序和未来容差；Run 上也记录最近回答时间，
防止跨 Grant 回退。有效窗口内发生、窗口后才上传的回答仍可接纳。未知或不可信时间保留输入，
不改用接收时间补造学习发生时间。离线只继续已有授权且材料已下载的 Run，不能新建。

C05–C09 的本地可执行返回统一为 `{plan,runtime:{activity,run,reason,summary?}}`；
Activity 含自己的 revision。此为原设计返回字段的结构化落地，并未增加客户端结算权限。

旧路径离线仅继续已有授权且材料已下载的 Run；本机正式运行可以离线新建，二者不要混用。
`consumer-review-v1` 与 `consumer-relearning-v1` 各自固定材料和 purpose。again 建立 10 分钟
重学需要，可显式提前；再次遗忘重排等待，重学成功不改原 Memory Outcome。Activity 模式
固定，review-only 不恢复首学；汇总按目标去重，pending 单列。

签到独立于学习事务与 Evidence：实际进入可作答 Run 或手动操作才触发，同账号日一次。
原日期由可信发生时间确定，不能替换为上传日。C11 使用 `{grantId,sessionId,elapsedMs}`，
结果为 `{plan,checkin,alreadyRecorded}`；Q08 最多 366 条，界面当前及前 11 个月。
签到失败不阻断后续学习操作，刷新不得重用旧页面单调时钟校准。

## 采集、语义与资源

- 插件专用授权使用 PKCE S256，绑定账号、Session、epoch、安装和期限；重连原账号保留原队列。
  未知存储版本停止上传，跨账号关闭旧浮层并隔离迟到结果；解包扩展重启不能等同商店热更新。
- 未接受 lookup 不进入个人库存；完整 Context–Sense–Expression 经显式接受后保存，接受不自动入学。
  原位按需解释/快慢轨的当前行为见 [浏览器合同](browser-port-contract.md)。
- Task 固定 Target、Policy/Protocol、Demand、来源与授权；模型调用在事务外，独立验证后才冻结材料。
  原请求检查不重新收费；取消、撤销、过期与 lease 恢复不得接纳迟到结果或自动无限重试。
- 授权可保留私人经历中的人物、关系与事件，不默认匿名化，不编造新地点、动作或引语。
  原文是引用数据，不是指令或公共语言学事实。移除撤销未来使用，恢复列表不自动重授；
  已开始 Run 固定材料/回答/结算不改写，后续准备使用当前有效授权与 ready plan。
- 静态发音从受控目录按已接受表达摘要解析；材料引用 digest，不接纳模型自造媒体 URL。
  可选音频失败不丢弃文字材料。`content/tools/consumer_pronunciation.py --validate` 只读本地
  MP3；生成必须显式 opt-in，产物保持 Git 外，发布走 CI/CD，不能称为任意表达在线 TTS 服务。

## 回归入口与证据范围

准备仅用于测试的 loopback PostgreSQL（`sensa_m1a_` 前缀），逐文件事务应用迁移。
`SENSA_TEST_DATABASE_URL` 从本机环境注入；测试角色继承 backend_app，夹具额外邀请写权限
不得授予生产身份。`scripts/support/consumerTargetFixture.mts --write` 生成测试 SQL，不能发布为正式内容。

- `npm run sensa:consumer-checkin-smoke`：账号、目标、首学、复习/重学、签到的共享事务回归。
- `scripts/sensaConsumerAccountSmoke.mts --intake --semantic --provisioning`：M2 账号/语义/准备边界。
- `scripts/sensaConsumerAccountSmoke.mts --serve`：loopback 合成 OTP/JWT 夹具，仅用于开发服务调试。
  旧浏览器流程脚本已在用户流程重新确认前删除；它不是公网认证或真实邮件服务证据。
- `scripts/sensaConsumerAccountSmoke.mts --crash`：真实子进程 SIGKILL；生成/校验中断等待 lease
  到期后显式重试，ready 丢响应读取原材料。时钟推进与模型是替身，不能当托管灾备验收。
- `npm run sensa:consumer-settlement-smoke`：Node 与断网 Chrome 相同结算向量。
- `scripts/sensaRealProviderTrial.mts --validate` 无网络；`--allow-live` 为独立有界试验，
  不进入常规 CI。已有样本曾被独立 reviewer 漏判，确定性校验仍必要，不能推导普遍质量。

历史本地验证使用合成 Auth、真实隔离 Postgres 和受控媒体；有限 DeepSeek/edge-tts 样本与常规
替身验证分开。Chrome 149/151/152 有解包扩展及 activeTab 记录：点击授予、同源保留、跨源
失效、重新点击恢复。真实商店升级、生产监控、许可、托管故障恢复及公网性能另验。
当前发布状态见 [上线核查](web-launch-readiness.md)，不能沿用旧报告的环境未配置或下一步结论。

## 合同回归向量与性能预算

以下保留 M0-3 设计向量与测量约束，用于旧 Consumer 回归；向量编号不是通过证明。
| ID | 输入/故障 | 必须观察到的结果 |
| --- | --- | --- |
| V01 | L未确认数量，尝试C05；随后C01数量5重复投递 | 首次拒绝onboarding_required；一份计划、一次确认；重放返回原结果 |
| V02 | A/B同时把最后一个新学额度用于不同target | 只允许一个创建initial Run；另一个返回daily_limit；继续已开Run不再占额 |
| V03 | 已开始3项，limit从5降为2，再升为10 | remaining依次0、7；三项Run与固定材料不变；第二天继续不重新扣额 |
| V04 | 同L/S/E从catalog与book条目同时加入 | 一个retention、一个有效成员/覆盖结果；保留合法provenance；不同binding不合并；无隐式PersonalMeaning |
| V05 | 无效target且已有成员，或已声明已会再加入 | 先验证target/policy/声明，再判断already_in_scope；不能借重复加入绕过无效输入 |
| V06 | 目录材料校验失败/必需音频缺失 | 成员仍在，readiness blocked/media_missing；无Run/额度扣减；只有retryAllowed能重试 |
| V07 | 同operation发送两次/第二次改rating | 原文重放同结果；改文拒operation_id_reuse；不同新operation对旧Step返回stale_step |
| V08 | 终步response丢失；客户端刷新查结果再push | 一Completion、一handoff、一FSRS初始化；本机pending在知晓原结果后清除，不重答 |
| V09 | completion后写SchedulingDecision时注入错误 | Attempt/transition/completion/feed/result全部回滚；重放可一次完成，不留半个成功 |
| V10 | A/B对同due identity分别good/again | 一个有效Outcome和一次memory revision增长；另一个冲突保留输入，不自动套到新Review |
| V11 | 12:00 again，12:04其他项做完；12:10再出现 | 12:04显示6分钟等待，可结束/提前；刷新不改nextEligibleAt；恢复后再次again改为新10分钟 |
| V12 | Review again已落盘未结算，断网尝试新Relearning Run | 不新建Run；只保留需要/pending和合法其他学习；原Outcome结算后在线授权才启动重学 |
| V13 | 同已授权Run离线reveal→rate，多Step连锁，再联机 | 本机原子保存，服务器按固定协议/revision/dependency重放；前驱冲突后继保留不rebased；无客户端Completion事实 |
| V14 | bootstrap中断、cursor过期、晚提交事务 | 半份快照不替换当前投影；outbox保留；feed按提交序完整，无晚事务被cursor跳过 |
| V15 | A退出后B登录，原A pending及grant仍存在 | 不上传到B、不显示A私人材料；切回A合法身份再恢复；撤销/删除优先拒绝 |
| V16 | grant过期、设备时钟倒退、断网重启 | 保留输入与可解释状态，不假接纳、不以收到时间改签到日期；有效授权内迟上传按时间校验处理 |
| V17 | 手动签到与两设备进入正式Run同一天 | 一天一条checkin，formal有真实Run入口引用；浏览、解析、失败start不签到；不产生Evidence |
| V18 | 重学成功且原Review完成，另一个结果pending | review去重数不因重学重复增加，等待是needsRecall子集；pending单列，不能说全部完成 |
| V19 | v2旧outbox发到v3；旧Learner多个candidate映射 | upgrade/version拒绝并保留原载荷；迁移歧义隔离；不自动清库/重置/选第一行 |
| V20 | 未受邀有效JWT、错误issuer/audience、revoked session | 不读写私人scope；JWT认证与Sensa准入都必须通过；业务表无客户端直接写权限 |

M1 smoke覆盖V01–V20的关键事务与消费；M3扩展真实双设备/删除/中断恢复，M4再验收公网
邮件、商店、实际性能。M1不能因为M3另有深入测试就跳过本条链的数据完整性检查。

### 测量条件

M0-2的用户界面门保留：按钮反馈100ms内、缓存页面p95≤200ms、移动LCP≤2.5s、CLS≤0.1、
INP≤200ms。M1记录构建hash、Chrome稳定版确切版本、测试机CPU/内存/OS与网络配置；开发
对比采用390×844和1280×800两viewport，移动实验网络往返150ms/下载1.6Mbps/上传750Kbps，
CPU 4倍减速，至少20次冷加载和50次缓存页面转换；实验交互耗时不能冒充真实用户INP。
M4补实际手机及字段指标或可复现交互证据，未经测量不能标达标。

初始资源工程预算：正式首页入口JS压缩≤300KiB、CSS压缩≤100KiB；媒体按需加载且不计入
首页必需下载；任何超预算须用实测解释并优化或记录修订理由，不通过改阈值掩盖回退。
历史约615kB gzip JS仅为当时基线，不代表当前构建。插件解释网络耗时单独测，
不计为本机浮层反馈；受邀版记录provider调用量/失败/耗时与每日预算，禁止盲目无限重试。

API工程预算：有界push≤50项、body≤256KiB、pull页≤500项；Edge每请求CPU按官方限制验证，
不预承诺所有50项在2秒内。若实测过限先缩小批量/分开应用请求，仍维持单操作事务，客户端
不得因批次拆分生成新operationId。长生成任务M2持久task+独立attempt，不使用HTTP等待持久性。


## 原文追溯

阶段原文保留在 Git 提交 `559388e1121f0bfa18b5b4ba337ffdf6dcf86dc1` 及之前。按需使用
`git show 559388e1121f0bfa18b5b4ba337ffdf6dcf86dc1:docs/sensa/m1-c-initial-handoff.md` 读取对应文件；
同样适用于已移除的 M1/M2、浏览器 handoff、M0-3 delivery-plan 与 migration-foundation。
历史预算、机器路径和某轮通过记录不作为当前配置或运行授权。

## 旧 Consumer 接口设计与迁移保护

下列内容从原 M0-3 设计合同保留，用于解释旧 wire 和回归来源，不是新接口的发布清单。
设计中的 Query/Command 编号与类型示意不能替代可执行 schema；完整字段与实际支持范围
以 `packages/contracts/src/sensa/consumer/` 及 Consumer 路由为准。未实现操作明确拒绝，
不能因文档列出即视为可用。服务器 grant、bootstrap/outbox 规则只适用于该兼容路径。

### Query 与页面消费投影

GET 除签名媒体链接外不创建学习事实；空结果和失败不同。列表使用不透明 pageCursor，默认
20、最大 100；排序固定且有 ID 次序键；cursor 绑定查询条件与 scopeEpoch，错误返回重载说明。

| ID / 路径 | 参数 | data 形状与 M0-2 消费 |
| --- | --- | --- |
| Q01 `/sensa/home` | `mode` | HomeView：PlanView、Counts、ResumeItem[]、emptyReason；A03/A04/B07/B08/C06 |
| Q02 `/sensa/catalog/targets` | `q?, sourceId?, cursor?, limit?` | `{items:CatalogTarget[],nextCursor}`；A06/B01；零匹配不等于目录失败 |
| Q03 `/sensa/learning-targets/:id` 或 `/sensa/catalog/targets/:candidateId` | 无 | TargetView；B01–B06/B09；不存在或越权同样不给私人信息 |
| Q04 `/sensa/runs/:id` | 无 | RunView + 固定 MaterializationManifest；C01–C11，返回原 Run，不偷偷创建 |
| Q05 `/sensa/activities/:id/summary` | 无 | SummaryView；R03/C11，服务端确认与客户端 pending 分开 |
| Q06 `/sensa/operations/:id` | 无 | `{state:'known',result}` 或 `{state:'not_found'}`；T3/C04 |
| Q07 `/sensa/media/:id/access` | `runId, materializationId` | `{url,expiresAt,digest,byteLength,mimeType}`；T8，检查固定资源引用和访问权 |
| Q08 `/sensa/check-ins` | `month:YYYY-MM` | `{timeZone,days:LocalDate[],revision}`；K01–K03，不含本机未接纳天数 |

投影字段（均强制定义，不用页面猜测）：

- **PlanView**：`id,revision,scopeRevision,quantityConfirmed,dailyNewLimit,accountDate,timeZone,
  newStartedToday,newRemaining`。limit 仅 5/10/15/20/30；未确认计划可 null。
- **CatalogTarget**：`senseId,senseVersionId,bindingId,bindingVersionId,expression,meaning,
  targetLanguageTag,familiarLanguageTag,learnerLocale,source:{kind:'catalog'|'book',id,version},
  admission:'available'|'reference_only'|'unsupported'`；不能把未对齐 reference sense 当 stable sense。
- **TargetView**：`learningTarget`（既有 v2 snapshot）、`retentionTarget`（v2 snapshot）、
  `membership:{id,revision,status,provenances[]}|null,declaredMastery:{active,revision},
  plan:{id,revision,purpose,readiness,reason:Reason|null,retryAllowed,materializationId|null,
  policyId,policyVersion},phase:'new'|'acquiring'|'retaining'|'needs_relearning',dueAt|null`。
  目录尚未入学习时 Q03 使用可学习目录引用读取，learningTarget/retentionTarget 可 null；
  未加入详情走catalog candidate路径，已加入详情走learning-targets路径，不混用两种ID。
- **Counts**：`newAvailable,initialContinuations,dueReviews,relearningReady,relearningWaiting,
  distinctExecutableTargets`；前五项是工作分类，不相加冒充不同目标数。
- **ResumeItem**：`activityId,runId,retentionTargetId,purpose,revision,state,nextEligibleAt|null`。
  首页先呈现本机 pending result 区，再合并服务器合法继续点；本机旧 Run 不覆盖新投影。
- **HomeView.emptyReason**：`null|'no_targets'|'daily_limit'|'none_due'|'preparing'|'blocked'|
  'waiting_relearning'|'onboarding_required'`；网络失败不伪造成其中任何一项。
- **RunView**：`id,revision,activityId,learningTargetId,retentionTargetId,purpose,status,
  policy:{id,version},protocol:{id,version},materializationId,materialDigest,
  currentStep:{id,ordinal,phase:'recall'|'reveal',allowedActions:string[]}|null,nextEligibleAt:Instant|null,
  progress,completion:CompletionView|null,offlineGrant:OfflineGrant|null`。status=`active|completed|cancelled`。
  `progress:{attemptCount,cycleIndex}`；整数只说明协议进行，不代表掌握。
- **CompletionView**：`kind:'study_completion'|'review_completed'|'relearning_completion',
  completionId,outcomeId|null,handoffId|null,schedulingDecisionId|null,dueAt|null`；首学必须有
  handoff+decision；Review 必须有 outcome+decision；首版重学两者均 null，原 outcome另由来源引用。
- **SummaryView**：`activityId,status:'active'|'ended',initialTargetIds:Id[],reviewTargetIds:Id[],
  restoredTargetIds:Id[],needsRecallTargetIds:Id[],waitingTargetIds:Id[],nextEligibleAt|null,
  immediateAvailable:boolean`。集合为权威已确认结果，waiting ⊆ needsRecall；客户端 pending
  单独显示且按 target 去重。统计学习目标数取相应集合并集，不计揭示/重测次数。
- **MaterializationManifest**：`id,digest,contentSchemaVersion,protocolVersion,
  stepMaterials:[{stepKey,roleKey,required,disclosurePhase,resourceId,digest}],
  media:[{id,digest,byteLength,mimeType,required}],snapshot`。snapshot 按固定发布 schema验收；
  下载验证 digest 后原样缓存，签名 URL 不属于内容 digest，不将缺失资源自动替换成新版本。

### Command 闭合表

所有学习与签到写入都使用 `/sensa/sync/push`，payload 如下；标注 expected 的 revision 必填。
第 2 节的 Operation 外壳承载公共字段。结果 value 只使用第 4 节投影或本表列出的字段。
暂停不是 Run 取消；不新增客户端 complete/grade/fsrs-write 命令。

| ID / kind | payload | 接受结果/事务约束 | UI 状态 |
| --- | --- | --- | --- |
| C01 `plan.confirm_quantity` | `{expectedRevision:Revision|null,dailyNewLimit,timeZone}` | `{plan:PlanView}`；null 仅首次创建，一 learner 一计划；显式确认标记、初始轻量 assignment 和 scope 同事务 | A05 |
| C02 `plan.set_quantity` | `{planId,expectedRevision,dailyNewLimit}` | `{plan:PlanView}`；锁计划，重算今天剩余额度，已开始不变 | A05 |
| C03 `curriculum.add_target` | `{planId,expectedScopeRevision,candidateId,source:{kind:'catalog'|'book',id,version}}` | `{disposition:'accepted'|'already_in_scope',target:TargetView}`；验证目标→policy→声明冲突→去重→成员+plan | B01–B06 |
| C04 `learning.retry_preparation` | `{learningTargetId,expectedPlanRevision}` | `{target:TargetView}`；仅 retryAllowed 的状态，复用任务身份而不是重复生成 | B06/F01 |
| C05 `activity.start_or_resume` | `{mode,expectedScopeRevision,activityId:Id|null}` | `{activityId,run:RunView|null,reason:HomeView.emptyReason}`；在线创建/恢复，原子锁候选+额度+Run；resume 不额外扣数量 | B07/C06/C08 |
| C06 `run.record_action` | `{runId,expectedRevision,stepId,ordinal,materialDigest,grantId:Id|null,action}`，action=`{kind:'reveal'}` 或 `{kind:'rate',rating:Rating}` | `{run:RunView}`；记录 raw Attempt/transition；终步完成及调度同事务，规则见第 7 节 | C01/C02/C09/R04 |
| C07 `activity.next` | `{activityId,expectedRevision,mode,allowEarlyRelearning:boolean}` | `{activityId,activityRevision,run:RunView|null,reason,nextEligibleAt:Instant|null}`；优先恢复合法工作；允许切离“等待间隔”的重学 Run，但不得跳过未提交作答的当前 Step | C05/C11/R03 |
| C08 `activity.pause` | `{activityId,expectedRevision,runId:Id|null,afterOperationId:Id|null}` | `{activityId,activityRevision,status:'paused'}`；只存活动恢复位置，不取消 Run、不生成 Completion；本机落盘后可直接离开，命令待同步 | C03 |
| C09 `activity.end` | `{activityId,expectedRevision}` | `{summary:SummaryView}`；结束活动视图，Run/重学需要保留，未完成不冒称完成 | R03/C11 |
| C10 `declared_mastery.set` | `{retentionTargetId,expectedRevision,active:boolean}` | `{target:TargetView}`；声明独立，若有未结算回答返回 pending_result；不改历史/FSRS，撤销恢复合法候选 | B09 |
| C11 `check_in.record` | `{source:'manual'|'formal_learning',runId:Id|null,activityEntryOperationId:Id|null,timeZoneRevision}` | `{date:LocalDate,alreadyRecorded:boolean,revision}`；账号日去重；formal 必须依赖已接受的实际进入运行操作，manual 无 Run | K01–K03 |

C05 的 result 同时返回 `activityRevision`（本表省略在 Run 内无法代替它）；C07/C08/C09
比较活动 revision，不比较 run revision。活动恢复后新 activity 可以引用尚未结束的 Run，
旧活动的 summary 维持当时活动归属，不能因重新引用而把历史结果搬到新活动。

C03 candidateId 必须指向不可变目录候选，客户端送 source 仅作引用校验，不得传任意版本内容。
有效输入已在scope时C03返回already_in_scope，不因过期scope revision重复创建；若需要新增
成员则必须匹配expectedScopeRevision，否则冲突并要求读取最新scope。
M1 从 Book/Catalog 选择具体目标也可进入 Supplemental Membership，不强制整个 Book Enrollment；
未来整本 Enrollment 使用领域独立操作，不能用循环 add-target 伪造换词书生命周期。

### Sync v3、revision 与本机恢复

`POST /sensa/sync/push` body：`{wireVersion,canonicalizerVersion,scopeEpoch,replicaId,
operations:Operation[]}`，最多 50 条、请求最大 256 KiB。返回每条 Result、serverTime 和
`projectionRevision`；push 不前移 pull cursor。每条操作独立事务，按 dependsOn 拓扑顺序；
失败只阻塞依赖后继，不阻塞其他目标。引用未到达依赖返回 retryable missing_dependency。

`POST /sensa/sync/pull` body：`{wireVersion,scopeEpoch,replicaId,cursor,limit}`，limit 默认
100、最大 500。返回 `{changes:[{sequence,entityType,id,revision,action:'upsert'|'tombstone',
snapshot}],nextCursor,hasMore,serverTime}`。entityType 在 M1 固定为 account_access、plan、
source_membership、target、learning_plan、activity、run、relearning_need、check_in、
completion、memory_outcome、scheduling_decision；各 snapshot 绑定本合同/领域 schema。

采用 learner 内单调提交序号的统一 feed；每个写事务在 append 前锁 learner feed head，
保证 cursor 顺序即提交可见顺序，不能用普通 SQL sequence 分配顺序假定为提交顺序。
一事务可以多个 change；分页可拆但客户端先持久保存，不以部分投影推断完成，结果查询可补。
删除发布 tombstone；旧 cursor/epoch 返回 bootstrap_required，不清 outbox。

bootstrap 用固定高水位的一致快照分页；服务端保留 snapshot 至末页或超时，期间 changes
从 snapshot 高水位之后拉取。客户端暂存各页，末页一次切换投影+cursor，不能一页一页清空
在线展示。旧队列、冲突记录、账号分区和固定 Run 材料都保留。快照过期重取，不续用半份数据。

IndexedDB 写入 outbox+呈现 checkpoint 同一事务；push result、终态回执、投影更新和队列状态
同一事务；pull changes+cursor 同一事务。终态 conflict/rejected 转入 retained-inputs，停止
自动重试，提供原因与当前状态；accepted/replayed(accepted) 才解除 pending。一条 known
conflict 不永久阻塞全部学习；本机输入保留不代表以后一定计入正式结果。

网络未知不是服务端 status。HTTP 401/403：认证/准入；400：信封非法；409：epoch/version
冲突；413/429：限额；5xx：未知或可重试。合法 push 200 中可有业务 conflict/rejected。
最小 Failure codes：authentication_required、access_revoked、invite_required、upgrade_required、
bootstrap_required、operation_id_reuse、missing_dependency、revision_conflict、stale_step、
material_mismatch、offline_grant_invalid、invalid_target、unsupported_policy、declared_mastery_conflict、onboarding_required、daily_limit、
pending_result、content_unavailable、clock_untrusted、invalid_mode、rate_limited、temporarily_unavailable。
恢复入口由 code + retryable决定，不解析供应商英文错误文本。

本机同 Run 连续操作有 after dependency 和预期 revision链；服务端每个合法 action只递增
run revision一次。客户端可以按已下载协议作临时阶段演进，但不写 Completion/Outcome；
若前驱冲突，后继保留原输入且不得 rebased 到别的 Step。多标签写入以 IndexedDB原子读改写
控制同 Run本机序列；跨设备由服务器revision和唯一约束裁决，不依赖本机锁保证全局正确。

### 额度、Run、重学与调度事务

1. **每日数量**：首版每Sense固定primary binding，按target去重与每日new-Sense额度一致；
   未来多binding范围扩展必须重新核对额度合同。按账号时区的服务器开始日期，唯一 `(learner,accountDate,retentionTarget)`
   首次创建 initial Run占用一次。锁 plan和该日计数；newRemaining=max(0,limit-started)。
   调小不撤销已有 Run，调大只增加未开始资格。resume、Review、Relearning 不占新学额度；
   内容准备不占额度；下一日可继续旧 Run而不再扣。首次明确确认后才能开始任何正式学习。
2. **开始**：检查 Session/epoch→锁 plan/scope→选择 eligible target→锁 retention→重用活跃
   Run或创建 Run+Policy commitment+固定材料+起始Step+额度事实。一个 retention同一时刻
   只允许一个 active正式Run；Review固定触发的 memoryState revision和 due identity。
   首学未完成不能伪造 due Review；原 due已结算不能第二设备重复打开。activity的mode创建后固定，next必须匹配；
   首页切换mixed/review_only时暂停旧活动并创建/恢复对应活动，已有Run保留，review_only
   不恢复initial Run。该切换与新active activity唯一约束在同一事务处理。
3. **首学**：recall→reveal；reveal上 again→新 recall Step instance，hard/good→
   Study Completion（non_evidentiary）+Scheduling Handoff(protocol_completion)+初始FSRS。
   不建立 Gate或5D Evidence。初始化使用已版本固定的 scheduler policy，hard/good不伪装成
   初次 due Review评分；该初始配置固定为`sensa-lightweight-scheduling-v1`：复用FSRS-6，desiredRetention=0.9、
   maximumIntervalDays=36500，learningStepsMinutes=[]、relearningStepsMinutes=[]；应用级
   10分钟重学单独管理，避免FSRS短步骤再次排相同活动。初始化以新状态的good输入运行
   scheduler作为protocol_completion策略，不创建learner_rated Outcome；hard/good均适用。
   首版enableFuzz=false以便确定性复现；后续调整须版本化，M1用golden smoke验证。
4. **Review**：recall→reveal→一次 rating；again/hard/good 原值映射同名 Memory Outcome
   grade，basis=learner_rated/evidenceLevel=self_report；锁 memory revision并应用一次FSRS。
   again 同事务记录 relearning_need，hard/good不默认新增重学需要。原Review Run完成后方可
   创建Relearning Run；unique(triggeringOutcomeId)防重复need。
5. **重学**：need初始nextEligibleAt=被接受原rating的可信occurredAt+10分钟；其后每次
   relearning again按同规则重排。与M0-2“揭示后继续”对应的是提交rating动作；服务端延迟
   不强制额外重等10分钟。主动提前只由allowEarlyRelearning=true的在线命令或已授权重学
   能力启动。重学recall→reveal→again重排，hard/good完成恢复；首版无新Outcome、无FSRS更新。
   等待中的Run允许活动暂时转向其他target，恢复同Run不得重复建need或重置计时。
   存在未解决need的target不同时进入新的due Review候选；恢复后重新按既有FSRS due
   判断，重学不能把due顺延。这保证短期修复与新长期Review不争用同一target。
6. **原子终态**：Attempt+Transition+Completion/Outcome+SchedulingDecision+FSRS更新+
   feed+OperationResult在同一事务提交；任一失败全部回滚。首学handoff每retention一次，
   Review outcome每due identity一次，decision每outcome/handoff一次。数据库唯一约束
   与锁共同保证；客户端不再排一个 separate encounter.complete作为新协议的正常结算步骤。
7. **签到**：不并入学习结果事务；客户端实际收到/恢复Run并进入Runtime后落盘独立签到，
   formal引用接受的C05/C07及Run。只是创建Run但未进入界面不自动签到。日期以可信occurredAt
   与账号时区解析，唯一(learner,date)；重复手动/自动均只接纳一次，不增Evidence。

### 离线授权与时间规则

OfflineGrant 为服务端持久签发、可查询的 `{id,runId,learnerUserId,installationId,
replicaId,scopeEpoch,issuedAt,expiresAt,protocolVersion,materialDigest,baseRevision,
allowedActions:['reveal','rate']}`，默认有效期 7 天（工程初值，随发行版本配置固定）。
只在在线创建/恢复Run时签发；一Run可有多个安装的grant，服务器revision冲突仍裁决结果。
客户端仅在固定manifest及所有required材料digest验证通过后标“可离线继续”。

协议转换和step标识由固定protocol+run+ordinal决定并由服务端重算，客户端无权生成新的Run、
重学need、FSRS或Outcome。下载材料中可能包含答案，UI按披露阶段隐藏，这不是防作弊证明。
本机派生状态仅用于继续和恢复；重新联网必须授权+重放原始响应再读投影。

grant可用窗口内已落盘的操作允许之后上传；服务器核对grant归属、操作依赖、版本与时间，
不能只因上传晚就抹掉合法作答。操作可信时间通过签发时serverTime、安装单调时钟经过量和
重启标记校准；可接受的墙钟偏差初值5分钟，未来时间/矛盾时间/超出grant窗口返回
clock_untrusted并保留输入，不自行改成上传时间。断网重启后缺少可信校准时只展示“时间待
核对”，允许保留原始输入，恢复授权和必要复核后才结算；不以设备时钟延长grant。

7天之后不得再标“已授权离线继续”；用户输入可保留为未授权草稿，不承诺正式接纳。
明确撤销/删除在重连时优先拒绝，即使grant曾有效；账号切换不移交grant；内容后续更新不改
已冻结材料，但明确安全撤回可阻止后续接纳。M3验证离线已发授权与撤销交叉情况。


### 持久化身份与锁顺序

默认retentionScopeKey沿用0010的`general`；v2 scope definition对应kind=default。首版不新增
independent scope。Sense/Binding版本更替保留同一retention身份；active Run继续引用旧固定
LearningTarget和Materialization，不为更新canonical指针重写历史。一个历史retention关联多个
LearningTarget时，根据明确当前版本/创建记录选择canonical；无法唯一裁决的记录隔离为
migration_conflict，不能取MIN(id)、最近时间或覆盖用户事实。

事务锁顺序固定：account/access状态读→learner plan→activity→retention（多目标按ID排序）→
run→memory→feed head。幂等占位与结果和事务一起提交；死锁/序列化失败由服务器有限重试
同一operation，不产生新ID，不把数据库重试显示成新的学习行为。client expectedRevision
依旧要校验，数据库重试不是自动接受过时输入。


迁移先只读核对身份、版本、数量、摘要和未提交操作，再在隔离库回填 canonical 映射；
不改旧迁移、不删除旧账本、不把旧 Sense/Encounter 历史静默改为新 Target/Protocol。
访问控制以 issuer/subject 绑定 Account/Learner，不能按邮箱合并学习者。
旧私有 schema 不开放客户端直接写入；Node/Edge 复用业务入口与事务，不维持两份领域规则。
逐步切换时保留源快照和增量回退；产生新事实后不能简单恢复旧快照而丢弃新工作。

旧采集 wire 的 CaptureSnapshot 固定来源、Unicode occurrence 与语义候选版本，保存/接受/入学
各有独立命令；原账号的安装、PKCE、scope epoch、授权与幂等约束保持。完整字段见
`packages/contracts/src/sensa/consumer/`，当前产品交互见浏览器合同与 PRD。

本次移除的 M0 状态规格/接口设计/迁移蓝图、M2 分段合同与首轮基线，可从 Git `5f962ae41adb723dee34614060db9e41a8d0a4e8`
按原路径追溯。保留设计约束不表示重新启用旧产品限制或改变现有数据。
