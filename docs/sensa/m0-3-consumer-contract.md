# M0-3：M1 消费合同 v1

> 状态：设计合同已定稿；尚未实现的新接口，不能当作当前运行接口
> 日期：2026-09-07；产品依据：[M0-2 学习规格](m0-2-first-learning-state-spec.md)
> 共同交付：[迁移裁决](m0-3-migration-blueprint.md)、[施工与验收](m0-3-delivery-plan.md)

## 1. 适用范围和权威

覆盖 M1 的受邀认证、首次数量、direct 已发布目标、准备、轻量首学、Review、Relearning、
签到、暂停恢复和新同步。M2 个人语义/插件需求在第 10 节登记；完整提交合同须在 M2 前交付。
不修改七份领域模型，不把浏览器插件的“加入 Sensa”与“加入学习”合并。

本文采用 `sensa-consumer-v1`；新学习传输采用 `sensa-sync-v3`。旧 v1/v2 Sync 与
`sensa-learning-connection-v2` 不是同一个版本维度。旧操作不自动升级或重解释。
所有路由均相对 API base；可部署在 Edge Function 内部路径，客户端不拼接 workspace。

API 从已验证 Account Session 得到 LearnerScope，任何输入的 learner/account/workspace
标识不得用于授予访问。Account 拥有身份与撤销；Curriculum 拥有数量、来源、成员与计划；
Runtime 拥有 Run/Step/Attempt/Completion；Scheduling 拥有 Memory Outcome→FSRS 交接；
客户端只保存意图、原始响应、本机呈现和服务器投影。Postgres 为权威，IndexedDB/SQLite
均经本机 outbox → push → pull 收敛；Supabase Data API/Realtime 不代替该合同。

## 2. 语言无关的共同类型

以下是 JSON 的规范类型记法，TypeScript 只是表示法；不得发送 Date、Map、BigInt、NaN、
undefined 或依赖 JS 属性顺序。未定义字段拒绝；可空字段显式 null。标识均不从显示文案生成。

```ts
type Id = string;         // 新实体 UUID；既有 learnerUserId 保持不透明字符串
type Revision = string;   // 十进制非负整数，无前导零；避免 JS 大整数截断
type Instant = string;    // RFC3339 UTC，毫秒，例 2026-09-07T08:00:00.000Z
type Digest = string;     // lowercase SHA-256 hex
type LocalDate = string;  // YYYY-MM-DD，由账号时区解析
type Purpose = 'initial_learning' | 'retention_review' | 'relearning';
type Rating = 'again' | 'hard' | 'good';
type Mode = 'mixed' | 'review_only';
type Reason = 'not_configured' | 'preparing' | 'content_invalid' | 'media_missing'
  | 'unsupported_policy' | 'access_denied' | 'temporarily_unavailable';
type Ref = { id: Id; revision: Revision };
type Failure = {
  code: string; retryable: boolean; retryAfterMs: number | null;
  latest: Ref | null; field: string | null; messageKey: string;
};
type Query<T> = {
  contractVersion: 'sensa-consumer-v1'; serverTime: Instant;
  scopeEpoch: Revision; projectionRevision: Revision; data: T;
};
type Operation = {
  operationId: Id; kind: string; occurredAt: Instant;
  installationId: Id; replicaId: Id; dependsOn: Id[];
  payload: object;
};
type Result<T> =
  | { operationId: Id; status: 'accepted'; value: T }
  | { operationId: Id; status: 'replayed'; original: 'accepted' | 'conflict' | 'rejected'; value: T | null; error: Failure | null }
  | { operationId: Id; status: 'conflict' | 'rejected'; error: Failure }
  | { operationId: Id; status: 'retryable'; error: Failure };
```

`kind` 与 `payload` 必须按第 5 节封闭 union 生成 JSON Schema/Zod；上述 object 只是共同
信封占位，不允许任意运行载荷。新 revision 投影包装旧 v2 snapshot 时，旧 snapshot 仍按原
schema 验证，不能静默改变其中 number revision 的类型。

操作规范：

- 首次创建 operationId 时冻结 kind/payload/occurredAt/dependsOn，客户端先持久化再发送。
  Canonicalizer `sensa-sync-v3-canonical-1`：递归按 Unicode code point 排序 JSON 对象键，
  数组顺序保留，JSON 紧凑 UTF-8；禁止非有限数值与 -0，数字限制 safe integer，文本不自动
  trim/Unicode normalize。服务端计算 digest；M1 以跨语言 golden vectors 固定字节与转义。
- 幂等键是 `(learnerUserId, operationId)`；规范化内容还包括 wire/canonicalizer 版本和原
  installation/replica 身份。同键异内容 `operation_id_reuse`，不可覆盖。不得包含 bearer token。
- terminal accepted/conflict/rejected 与结果摘要持久保存，重放返回原业务结果；先授权检查，
  再查幂等，再检查 revision。撤销账号不能借历史结果查询重新获得私人数据。
- 同意图超时查询或重放同一操作；纠正字段/确认最新 revision 是新意图、新 ID。retryable
  不表示已拒绝且可丢弃；系统错误回滚整个操作后方可返回 retryable。无法确定时客户端标 unknown。
- 所有终态结果可查询到，未发出的本机意图不可能在其他设备查询到。query 的 not_found
  不证明旧请求已失败，可安全重放原 ID。结果账本首版不自动过期；删除按 M3 数据控制处理。

## 3. 认证、会话与首次安装

| 路径/动作 | 输入 | 输出和要求 |
| --- | --- | --- |
| Supabase Auth 发送/验证 email OTP | 邮箱/验证码，通过官方 SDK；不写入 Sensa outbox | provider Session；客户端关闭自动 signup，服务端关闭公开 signup，受邀账号由受控流程预置；不单靠客户端标志判邀请 |
| POST `/sensa/account/session` | bearer JWT；body `{installationId, platform, timeZone}`，platform=`web|extension|flutter`，timeZone 为有效 IANA 名称 | Query<AccountContext>；按 provider issuer+subject 和 session_id 幂等绑定，不按邮箱自动合并账号 |
| GET `/sensa/account/session` | bearer JWT | 同上；无 Session 401，未获 Sensa 资格 403；首次数量尚未确认仍返回合法账号上下文 |
| POST `/sensa/account/session/revoke` | 当前 bearer Session；`{operationId}` | 原 Session 幂等撤销；在清理本机前确认 pending 已处理，正常退出不抹除其他设备会话 |
| POST `/sensa/sync/bootstrap` | bearer、installationId、replicaId 可空、wireVersion=`sensa-sync-v3` | replicaId、scopeEpoch、snapshotId、pageCursor、syncCursor、分页投影；首次 replica 由服务端建立并绑定安装 |

AccountContext 字段：`accountId, learnerUserId, accountSessionId, installationId,
accessStatus:'invited', timeZone, timeZoneRevision, quantityConfirmed:boolean,
plan:PlanView|null, supportedWireVersions:string[], minClientVersion:string`。
时间区初次以设备值建立账号设置，之后设备不得自动覆盖；email 仅展示和投递，不是学习身份。

JWT 校验 issuer/audience/signature/expiry，并查 Sensa Account 状态、受邀资格、Session
撤销与 scopeEpoch；不以“JWT 尚未过期”代替授权。JWT refresh 由认证 adapter 串行管理，
不入业务 outbox、不记日志；Web/Flutter各自安全存储；扩展不能读取 Web localStorage。
Session 绑定失败时不给私人 bootstrap。account/session 初始化允许登录幂等写，不算学习命令。

若本机存在其他账号数据，分别按 account+learner 分区打开；不同账号不能共用投影、游标或队列。
首次数量确认 pending 可在首页显示，但正式 Run 启动必须见到服务器已确认的计划。

## 4. Query 与页面消费投影

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

## 5. Command 闭合表

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

## 6. Sync v3、revision 与本机恢复

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

## 7. 额度、Run、重学与调度事务

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

## 8. 离线授权与时间规则

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

## 9. 对外 Interface 与内部事务 seam

```ts
interface LearningApplication {
  query(scope: LearnerScope, query: ConsumerQuery): Promise<ConsumerProjection>;
  execute(scope: LearnerScope, operation: ConsumerOperation): Promise<ConsumerResult>;
}
interface RuntimePolicy {
  transition(run: FixedRun, action: RawAction): TransitionDecision;
}
interface SchedulingPort {
  initialize(input: InitialHandoff, previous: null): SchedulingDecision;
  review(input: MemoryOutcome, previous: MemoryState): SchedulingDecision;
}
interface UnitOfWork {
  inLearnerTransaction<T>(scope: LearnerScope, work: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

上述名字为第 4–8 节字段union和领域类型的聚合名，不是任意 object RPC；M1实现时从合同
生成定义。query/execute是应用入口，内部Account/Curriculum/Runtime/Scheduling各自保持所有权，
不制造只有转发作用的一层层helper。Kernel不导入数据库、React、Auth SDK或网络；Repository
Adapter承担SQL与锁；客户端与Flutter只依赖语言无关JSON，不导入服务端kernel执行授权。

## 10. 插件与后续功能消费需求（非 M2 完整合同）

- 扩展独立installation/replica；认证回跳绑定state、PKCE、一次性code与原安装，不在URL传
  access/refresh token或原句。复用Web认证通过受控授权跳转，禁止直接读Web本机存储。
- lookup输入固定sentence、expression occurrence、source URL/title/capturedAt和language，
  单位为Unicode code point的半开span，Web UTF-16需转换；句子hash/同词形不是独立接受凭证。
- query解释不是接受；accept传固定candidate/revision和explicit consent的operation identity；
  服务端原子创建完整Context–Expression–Sense事实。无法闭合进入Inbox，无默认Focus、无强迫聊天。
- complete意义与Inbox分别投影；同句同表达重复提示已加入；跨来源同文/多occurrence需在
  M2通过真实样本确定保存身份，不用技术重试ID替代产品去重。确认后不自动Curriculum入学。
- Web深链只读既有意义/Inbox；not_found/another account/pending/unknown有恢复；扩展更新
  保留原wire载荷，不以新版本解释旧操作。删除撤销共享Account/scopeEpoch屏障。
- Free Practice、词典、统计、个人内容完整合同随M2/M3用例补齐；允许开放不等于已接生产。
  M1的check_in与Summary不提前扩张为全站统计或额外激励体系。

## 11. 规范载荷示例

此例为已完成账号/replica初始化后的首次确认数量请求，UUID仅为固定测试样本，不是实际用户：

```json
{
  "wireVersion": "sensa-sync-v3",
  "canonicalizerVersion": "sensa-sync-v3-canonical-1",
  "scopeEpoch": "1",
  "replicaId": "22222222-2222-4222-8222-222222222222",
  "operations": [{
    "operationId": "33333333-3333-4333-8333-333333333333",
    "kind": "plan.confirm_quantity",
    "occurredAt": "2026-09-07T08:00:00.000Z",
    "installationId": "11111111-1111-4111-8111-111111111111",
    "replicaId": "22222222-2222-4222-8222-222222222222",
    "dependsOn": [],
    "payload": {"expectedRevision": null, "dailyNewLimit": 5, "timeZone": "Asia/Shanghai"}
  }]
}
```

接受返回C01的PlanView，quantityConfirmed=true、newStartedToday=0、newRemaining=5；原载荷
重放返回replayed(original=accepted)和同一计划。把5改10且保留operationId必须拒绝
operation_id_reuse；合法后续调整应使用C02、新operationId及最新plan revision。

JSON payload整数、UUID、版本、timezone以及Operation字段均由严格schema验证；未知字段、
不存在kind、非法依赖环和超过批量/体积限制在执行前拒绝。batch中的replicaId必须等于信封，
installation必须属于该replica。partial accepted不重发新ID，按每条result收敛。
