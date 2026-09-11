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
- `scripts/sensaConsumerAccountSmoke.mts --serve`：loopback 合成 OTP/JWT 夹具；浏览器流程见
  `scripts/sensaConsumerBrowserSmoke.mts`。不是公网认证或真实邮件服务。
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
