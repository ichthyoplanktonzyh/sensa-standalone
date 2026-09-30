/**
 * Stable audit identities aligned to Long Journey V0.2 (b4d782c8).
 *
 * The 142 Capability/REL and 157 Scenario identities are retained from the
 * existing V0.2 audit. auditOracle, baselineScope and baselineVerdict are
 * historical adjudication inputs, not current product truth or passing results.
 * CONTEXT, canonical domain documents, PRD and user-journeys own requirements.
 * The temporary audit reports stay ignored and are not runtime dependencies.
 *
 * Crosswalk membership establishes traceability, never whole-journey coverage.
 * Evidence contributions describe only the assertions and boundaries actually
 * traversed. Remaining branches and operator decomposition stay explicit.
 */
export type LongJourneyId = `LJ-${string}` | `SJ-${string}` | `OJ-${string}`;
export type LegacyJourneyId = `JRN-${string}`;
export type CapabilityId = `CAP-${string}` | `REL-${string}`;
export type ScenarioId = `SCN-${string}`;
export type EvidenceLayer = 'unit' | 'contract' | 'integration' | 'database'
  | 'browser' | 'browser-db' | 'extension-browser' | 'artifact' | 'external';

/** Shared guards run with a journey; they do not replace its user-facing evidence. */
export const journeySupportingTests: readonly Readonly<{journeyIds:readonly LongJourneyId[];testId:string;scope:string}>[] = [
  {journeyIds:['LJ-01'],testId:'package-workspace-refresh',scope:'Committed record-key notifications avoid inventory rereads for learning actions while retaining catalog/cache/clear refresh; no browser latency claim.'},
  {journeyIds:['LJ-01'],testId:'package-cache-projection',scope:'Atomic SQLite summary and identity projections, including source-preserving rebuild; no browser latency claim.'},
  {journeyIds:['LJ-01'],testId:'portable-learning-registry',scope:'Published Book validation, final-member transaction rollback and cache recovery.'},
  {journeyIds:['LJ-01'],testId:'book-installation-journey',scope:'Atomic rejection, cancelled transfer, explicit and idempotent enrollment through shared Module Interfaces.'},
  {journeyIds:['LJ-01'],testId:'portable-package-loop',scope:'Portable admission, identity, author metadata and media integrity.'},
  {journeyIds:['LJ-01'],testId:'package-learning',scope:'Initial learning, due review and relearning settlement; not browser UX.'},
  {journeyIds:['LJ-01'],testId:'library-transaction-and-replay',scope:'Atomic device transactions and replay; not all journey concurrency branches.'},
  {journeyIds:['LJ-01'],testId:'web-bundle-budget',scope:'Production artifact and lazy-module budget; not real-device CWV.'},
  {journeyIds:['LJ-01'],testId:'web-bootstrap-budget',scope:'Responsive local shell during slow account restore, bounded requests and idle network.'},
  {journeyIds:['LJ-01'],testId:'sqlite-opfs-benchmark',scope:'Real Chromium/OPFS query, transaction and scale regressions; not end-to-end latency.'},
  {journeyIds:['LJ-01'],testId:'sqlite-sahpool-preservation',scope:'Pinned SQLite bootstrap failures retain data and settle every in-flight handle acquisition before cleanup; pure protection checks, not browser recovery proof.'},
  {journeyIds:['LJ-01'],testId:'sqlite-sahpool-recovery',scope:'Real isolated Chromium/OPFS retains a synthetic committed sentinel after pool-handle contention and abrupt Worker termination; not end-to-end Book latency.'},
  {journeyIds:['LJ-01'],testId:'book-center-projection',scope:'Linear publication grouping and bounded visible rows at 10,000 entries; pure projection evidence, not browser latency.'},
  {journeyIds:['LJ-01'],testId:'portable-book-capacity',scope:'Sequential 5,000/10,000-member low-media Books through real Chromium/OPFS installation, explicit enrollment, reload and an actual learning action. Stage deadlines are safety limits, not UX acceptance budgets.'},
];

export function journeyTestIds(journeyId:LongJourneyId):readonly string[]{
  if(!longJourneyMappings.some(journey=>journey.journeyId===journeyId))throw new Error(`Unknown Journey: ${journeyId}`);
  return [...new Set([
    ...scenarioEvidenceContributions.filter(item=>item.journeyIds.includes(journeyId)).map(item=>item.testId),
    ...journeySupportingTests.filter(item=>item.journeyIds.includes(journeyId)).map(item=>item.testId),
  ])];
}

/**
 * Contributions are assertion scopes, not latest-run PASS records. 'oracle'
 * covers this Scenario's automated oracle only; Agent UI and External are separate.
 * Historical baseline verdicts never change merely because a test is linked.
 */
export const scenarioEvidenceContributions: readonly ScenarioEvidenceContribution[] = [
  {scenarioId:'SCN-CAT-001',journeyIds:['LJ-01'],phase:'discovery',branch:'cross-origin-cached-revision',oracle:'缓存公开目录在独立 API Origin 上以原 revision 条件刷新，真实预检允许 if-none-match，304 后仍保留原目录。',testId:'package-center-journey',testCase:'a cached public catalog refreshes across origins with its exact revision',claimedLayers:['browser'],coverage:'partial',remainingGaps:['不覆盖全部离线、过期及生产 API 鉴权分支。']},
  {scenarioId:'SCN-BOOK-002',journeyIds:['LJ-01'],phase:'installation-recovery',branch:'cancel-active-preparation-worker',oracle:'完整网络传输后在准入 Worker 仍运行时取消，Worker 关闭且无安装、Target 或刷新后的假已下载状态。',testId:'package-center-journey',testCase:'cancelling admission after complete transfer closes its Worker without installing any members',claimedLayers:['browser'],coverage:'partial',remainingGaps:['不把提交开始后的请求描述为可回滚；mutation yield 取消与提交决定由独立事务检查证明。']},
  {"scenarioId":"SCN-CAT-001","journeyIds":["LJ-01"],"phase":"discovery","branch":"anonymous-cold-catalog","oracle":"游客通过实际产品目录看到公开 Book，请求不携带账号权限。","testId":"package-center-journey","testCase":"a guest can browse the public package catalog without an account session","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["缓存优先、过期、离线和刷新策略；真实 API 鉴权另有边界。"]},
  {"scenarioId":"SCN-LOCAL-001","journeyIds":["LJ-00","LJ-01"],"phase":"local-library","branch":"guest-entry-and-reload","oracle":"未登录用户从公开 CTA 建库，通过 UI 安装和学习，刷新后仍看到自己的内容与记录。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"oracle","remainingGaps":[]},
  {"scenarioId":"SCN-BOOK-001","journeyIds":["LJ-01"],"phase":"atomic-installation","branch":"validated-large-book","oracle":"真实 Chromium 下载包含 100 个成员的 Book，并在 OPFS 中看到完整内容；明确加入触发一次有界目标提交。","testId":"package-center-journey","testCase":"discovers, downloads and enrolls a Book with durable local state","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["事务层验证由独立 integration 贡献支持；此用例不覆盖所有安装失败分支。"]},
  {"scenarioId":"SCN-BOOK-002","journeyIds":["LJ-01"],"phase":"installation-recovery","branch":"corrupt-outer-archive-and-retry","oracle":"损坏下载不显示已安装或可加入；刷新后仍未安装，用户重试后可以明确加入。","testId":"package-center-journey","testCase":"a corrupt Book download remains uninstalled and can be retried through the UI","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["内部第 N 个成员失败、取消和旧版本保留。"]},
  {"scenarioId":"SCN-BOOK-003","journeyIds":["LJ-01","LJ-06"],"phase":"explicit-enrollment","branch":"download-is-not-enrollment","oracle":"下载和刷新后仍未加入；独立加入后才出现可开始的学习入口。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["重复加入与路线不匹配的用户出口。"]},
  {"scenarioId":"SCN-READY-001","journeyIds":["LJ-01","LJ-06","LJ-07"],"phase":"readiness","branch":"installed-book-ready","oracle":"已校验内容经明确加入后，Today 显示真实开始入口，并能进入实际学习步骤。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["缺资源、损坏材料与协议不可用时的 Home 状态。"]},
  {"scenarioId":"SCN-LEARN-003","journeyIds":["LJ-07"],"phase":"initial-learning","branch":"lightweight-recall-reveal-rating","oracle":"用户通过界面回想、揭示与评分，看到真实完成；返回后存在一条持久初学记录和后续复习安排。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"oracle","remainingGaps":[]},
  {"scenarioId":"SCN-LEARN-005","journeyIds":["LJ-07"],"phase":"runtime-recovery","branch":"reload-and-pause-resume","oracle":"揭示后刷新和暂停再刷新仍恢复同一 Run、Step 与材料，不重做已完成动作。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["关闭浏览器重开、显式 Worker 终止、重复 Action 与 revision conflict。"]},
  {"scenarioId":"SCN-LEARN-007","journeyIds":["LJ-07"],"phase":"settlement","branch":"completion-and-reload","oracle":"完成后刷新不重复可见初学记录，已完成目标具有真实后续复习安排。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["写失败、同 operation 重放、并发及丢回执；不认领其唯一 Evidence/Memory revision。"]},
  {"scenarioId":"SCN-STUDY-OVERVIEW-002","journeyIds":["LJ-10"],"phase":"history","branch":"completed-initial-record","oracle":"用户通过导航进入我的学习，刷新前后仍看到一条对应表达的初学记录。","testId":"package-center-journey","testCase":"a guest learns a Book through the UI and resumes the revealed step after reload","claimedLayers":["browser"],"coverage":"partial","remainingGaps":["日期、类型、语言筛选、无效范围和从记录返回目标。"]},
  {scenarioId:'SCN-BOOK-002',journeyIds:['LJ-01'],phase:'installation-recovery',branch:'last-member-cancel-old-enrollment',oracle:'第 100 个成员损坏、更新传输取消及刷新后，旧 100 个成员和原 Enrollment/Targets 保持不变；重试可下载完整新版本，但不会自动应用。',testId:'package-center-journey',testCase:'a failed final member and a cancelled update leave the complete previous Book usable',claimedLayers:['browser'],coverage:'partial',remainingGaps:['事务内失败的回滚由独立 integration 贡献支持；此用例不是全位置写故障注入。']},
  {scenarioId:'SCN-BOOK-002',journeyIds:['LJ-01'],phase:'installation-recovery',branch:'atomic-module-admission-and-cancel',oracle:'Module Interface 拒绝最后成员损坏和已取消传输，原安装集合完整保留，正常重试不自动加入。',testId:'book-installation-journey',testCase:'Book update rejection and cancellation preserve installed content before explicit idempotent enrollment',claimedLayers:['integration'],coverage:'partial',remainingGaps:['不证明真实网络、OPFS 与 UI 的取消呈现；这些由 browser 贡献支持。']},
  {scenarioId:'SCN-BOOK-001',journeyIds:['LJ-01'],phase:'atomic-installation',branch:'final-member-transaction-conflict',oracle:'最终成员的已有 installation 冲突会回滚完整 Book：零新 cache，仅保留一个原 installation；正常安装与缓存修复随后成功。',testId:'portable-learning-registry',testCase:'official Registry delivers one atomic Book while preserving independent Sense packages',claimedLayers:['integration'],coverage:'partial',remainingGaps:['不证明浏览器 UI 与 OPFS；不枚举全部提交时 I/O 故障。']},
  {scenarioId:'SCN-BOOK-003',journeyIds:['LJ-01'],phase:'explicit-enrollment',branch:'idempotent-book-enrollment',oracle:'安装后零 Targets；明确加入产生一份 Enrollment 和同一组 Targets，再次加入不复制身份。',testId:'book-installation-journey',testCase:'Book update rejection and cancellation preserve installed content before explicit idempotent enrollment',claimedLayers:['integration'],coverage:'partial',remainingGaps:['UI 路线不匹配由独立 browser 贡献支持；此用例未模拟多标签同时提交。']},
  {scenarioId:'SCN-BOOK-003',journeyIds:['LJ-01'],phase:'explicit-enrollment',branch:'route-mismatch',oracle:'西班牙语 Book 可保存，但英语路线中的加入按钮禁用且显示真实不匹配状态；刷新后仍零 Targets。',testId:'package-center-journey',testCase:'a route-mismatched Book stays downloaded without silently enrolling',claimedLayers:['browser'],coverage:'partial',remainingGaps:['未覆盖切换到匹配路线后的完整用户出口。']},
  {scenarioId:'SCN-LEARN-005',journeyIds:['LJ-01','LJ-07'],phase:'runtime-recovery',branch:'chromium-profile-close-reopen',oracle:'完全关闭 Chromium 并以同一隔离 profile 重开，UI 继续同一已揭示 Run/Step/material，完成后有真实记录。',testId:'package-center-journey',testCase:'closing and reopening Chromium restores the same revealed learning step',claimedLayers:['browser'],coverage:'partial',remainingGaps:['显式 Worker 终止、重复 Action 与 revision conflict 仍不由此用例证明。']},
  {scenarioId:'SCN-REVIEW-001',journeyIds:['LJ-01','LJ-08'],phase:'retention-review',branch:'actual-due-offline-review',oracle:'仅把浏览器时钟推进到初学产生的 nextReviewAt；断网后从 Today 开始同一 Target 的新复习 Run，完成产生 retention_review 记录和更晚的复习时间。',testId:'package-center-journey',testCase:'a guest learns a Book through the UI and resumes the revealed step after reload',claimedLayers:['browser'],coverage:'partial',remainingGaps:['不覆盖所有到期优先级、跨日限额与 Again 后重学分支。']},
  {scenarioId:'SCN-PERF-001',journeyIds:['LJ-01'],phase:'performance',branch:'catalog-book-controlled-scale',oracle:'342 Catalog entries、100 members、4x CPU 和 300ms fixture 响应延迟下，发现/搜索/安装/加入/恢复满足具名 CI 预算，空闲不轮询 Catalog。',testId:'package-center-journey',testCase:'the Book journey stays responsive with 342 catalog entries and a 100-member Book at 4x CPU',claimedLayers:['browser'],coverage:'partial',remainingGaps:['构建与慢账号恢复由共享守卫支持；此用例不是真实设备 CWV、5,000-member Book 或生产后端负载证据。']},
  {scenarioId:'SCN-RESP-001',journeyIds:['LJ-01'],phase:'responsive',branch:'guest-book-320px',oracle:'320px 下从首次进入、Book 下载加入到学习完成，主要按钮可操作且页面没有横向丢失。',testId:'package-center-journey',testCase:'the guest Book path keeps its primary actions reachable at 320px',claimedLayers:['browser'],coverage:'partial',remainingGaps:['zoom、软键盘、键盘导航与其他长旅程不由此用例证明。']},
];

export function scenarioLongJourneyIds(scenarioId: ScenarioId): readonly LongJourneyId[] {
  const scenario=auditedScenarios.find(item=>item.id===scenarioId);
  if(!scenario)throw new Error(`Unknown Scenario: ${scenarioId}`);
  return longJourneyMappings.filter(journey=>journey.capabilityIds.some(id=>scenario.capabilityIds.includes(id))).map(journey=>journey.journeyId);
}

/** Validate identity and execution-boundary links, never infer coverage from filenames. */
export function validateJourneyMapping(tests: readonly Readonly<{id:string;environment:string;runner:string}>[]): void {
  const capabilities=new Set(auditedCapabilities.map(item=>item.id));
  const scenarios=new Map(auditedScenarios.map(item=>[item.id,item]));
  const journeys=new Set(longJourneyMappings.map(item=>item.journeyId));
  for(const support of journeySupportingTests){
    if(!support.scope.trim()||!tests.some(test=>test.id===support.testId))throw new Error(`Unknown or unscoped journey supporting Test: ${support.testId}`);
    for(const id of support.journeyIds)if(!journeys.has(id))throw new Error(`Unknown supporting Journey: ${id}`);
  }
  if(capabilities.size!==auditedCapabilities.length || scenarios.size!==auditedScenarios.length || journeys.size!==longJourneyMappings.length){
    throw new Error('Duplicate journey audit identity');
  }
  const mapped=new Set([...longJourneyMappings.flatMap(item=>item.capabilityIds),...crosscuttingCapabilityIds]);
  for(const capability of auditedCapabilities){
    if(!mapped.has(capability.id))throw new Error(`Unmapped Capability: ${capability.id}`);
    if(capability.baselineScope==='current'&&!auditedScenarios.some(scenario=>scenario.capabilityIds.includes(capability.id))){
      throw new Error(`Current Capability without Scenario: ${capability.id}`);
    }
  }
  for(const id of mapped)if(!capabilities.has(id))throw new Error(`Unknown mapped Capability: ${id}`);
  for(const scenario of auditedScenarios){
    if(!scenario.auditOracle.trim()||!scenario.phase||!scenario.minimumLayers.length)throw new Error(`Incomplete Scenario: ${scenario.id}`);
    for(const id of scenario.capabilityIds)if(!capabilities.has(id))throw new Error(`Unknown Scenario Capability: ${id}`);
  }
  for(const evidence of scenarioEvidenceContributions){
    const scenario=scenarios.get(evidence.scenarioId),test=tests.find(item=>item.id===evidence.testId);
    if(!scenario||!test)throw new Error(`Unknown Scenario/Test evidence: ${evidence.scenarioId}/${evidence.testId}`);
    if(!evidence.oracle.trim()||!evidence.testCase.trim())throw new Error('Evidence needs an assertion scope and named test case');
    for(const id of evidence.journeyIds)if(!journeys.has(id))throw new Error(`Unknown evidence Journey: ${id}`);
    if(evidence.coverage==='partial'&&!evidence.remainingGaps.length)throw new Error(`Partial evidence without gap: ${evidence.scenarioId}`);
    if(evidence.coverage==='oracle'&&scenario.minimumLayers.some(layer=>!evidence.claimedLayers.includes(layer)))throw new Error(`Insufficient evidence layer: ${evidence.scenarioId}`);
    for(const layer of evidence.claimedLayers){
      if(layer==='browser'&&(test.runner!=='playwright'||!['chromium','browser-postgres'].includes(test.environment))){
        throw new Error(`Browser evidence outside browser boundary: ${test.id}`);
      }
      if(layer==='browser-db'&&test.environment!=='browser-postgres')throw new Error(`Database evidence outside database boundary: ${test.id}`);
    }
  }
}


export type ScenarioEvidenceContribution = Readonly<{
  scenarioId: ScenarioId;
  journeyIds: readonly LongJourneyId[];
  phase: string;
  branch: string;
  oracle: string;
  testId: string;
  testCase: string;
  claimedLayers: readonly EvidenceLayer[];
  coverage: 'partial' | 'oracle';
  remainingGaps: readonly string[];
}>;

export const longJourneyMappings: readonly Readonly<{
  journeyId: LongJourneyId; legacyJourneyIds: readonly LegacyJourneyId[];
  capabilityIds: readonly CapabilityId[]; gap?: string;
}>[] = [
  {"journeyId":"LJ-00","legacyJourneyIds":["JRN-01","JRN-02"],"capabilityIds":["CAP-SHL-01","CAP-SHL-02","CAP-SHL-03","CAP-SHL-04","CAP-SHL-05","CAP-DAT-01","CAP-DAT-23"]},
  {"journeyId":"LJ-01","legacyJourneyIds":["JRN-09"],"capabilityIds":["CAP-CSU-01","CAP-CSU-02","CAP-CSU-03","CAP-CSU-04"]},
  {"journeyId":"LJ-02","legacyJourneyIds":["JRN-09"],"capabilityIds":["CAP-CSU-06","CAP-CSU-07","CAP-CSU-08","CAP-CSU-09"]},
  {"journeyId":"LJ-03","legacyJourneyIds":["JRN-04","JRN-07","JRN-08"],"capabilityIds":["CAP-PSW-01","CAP-PSW-02","CAP-PSW-03","CAP-PSW-04","CAP-PSW-05","CAP-EXT-01","CAP-EXT-06","CAP-EXT-11","CAP-EXT-12","CAP-EXT-13","CAP-AGT-03","CAP-AGT-04","CAP-AGT-05","CAP-AGT-06","CAP-AGT-07","CAP-AGT-08"]},
  {"journeyId":"LJ-04","legacyJourneyIds":["JRN-05"],"capabilityIds":["CAP-PSW-08","CAP-PSW-09","CAP-PSW-10"]},
  {"journeyId":"LJ-05","legacyJourneyIds":["JRN-06","JRN-10"],"capabilityIds":["CAP-LRN-20"]},
  {"journeyId":"LJ-06","legacyJourneyIds":["JRN-10"],"capabilityIds":["CAP-PSW-11","CAP-PSW-16","CAP-LRN-01","CAP-LRN-02","CAP-CSU-10","CAP-CSU-11","CAP-CSU-12","CAP-CSU-14"]},
  {"journeyId":"LJ-07","legacyJourneyIds":["JRN-12","JRN-14"],"capabilityIds":["CAP-SHL-06","CAP-LRN-03","CAP-LRN-04","CAP-LRN-05","CAP-LRN-06","CAP-LRN-07","CAP-LRN-08","CAP-LRN-09","CAP-LRN-10","CAP-LRN-13","CAP-LRN-14","CAP-LRN-15","CAP-LRN-23"]},
  {"journeyId":"LJ-08","legacyJourneyIds":["JRN-13","JRN-14"],"capabilityIds":["CAP-SHL-06","CAP-LRN-04","CAP-LRN-07","CAP-LRN-10","CAP-LRN-11","CAP-LRN-13","CAP-LRN-23"]},
  {"journeyId":"LJ-09","legacyJourneyIds":["JRN-13","JRN-14"],"capabilityIds":["CAP-SHL-06","CAP-LRN-04","CAP-LRN-07","CAP-LRN-10","CAP-LRN-12","CAP-LRN-13","CAP-LRN-23"]},
  {"journeyId":"LJ-10","legacyJourneyIds":["JRN-09","JRN-10","JRN-11","JRN-14"],"capabilityIds":["CAP-CSU-05","CAP-CSU-15","CAP-LRN-13","CAP-LRN-21","CAP-LRN-22","CAP-LNG-06"]},
  {"journeyId":"LJ-11","legacyJourneyIds":["JRN-04","JRN-06"],"capabilityIds":["CAP-PSW-06","CAP-PSW-07","CAP-PSW-12","CAP-PSW-13","CAP-PSW-15","CAP-PSW-16"]},
  {"journeyId":"LJ-12","legacyJourneyIds":["JRN-15"],"capabilityIds":["CAP-LRN-16","CAP-LRN-17"]},
  {"journeyId":"LJ-13","legacyJourneyIds":["JRN-07"],"capabilityIds":["CAP-EXT-01","CAP-EXT-04","CAP-EXT-05","CAP-EXT-07","CAP-EXT-08","CAP-EXT-09","CAP-EXT-10","CAP-EXT-14","CAP-EXT-15","CAP-LNG-03","CAP-LNG-08"]},
  {"journeyId":"LJ-14","legacyJourneyIds":["JRN-06"],"capabilityIds":["CAP-PSW-14"]},
  {"journeyId":"LJ-15","legacyJourneyIds":["JRN-16"],"capabilityIds":["CAP-LRN-18","CAP-LRN-19"],"gap":"The legacy audit has no Scenario for delivered Listening; full Practice Profile remains a separate future scope."},
  {"journeyId":"LJ-16","legacyJourneyIds":["JRN-17"],"capabilityIds":["CAP-DAT-02","CAP-DAT-03","CAP-DAT-04","CAP-DAT-05","CAP-DAT-06","CAP-DAT-07","CAP-DAT-08","CAP-DAT-09","CAP-DAT-10","CAP-DAT-11","CAP-DAT-12","CAP-DAT-21","CAP-CSU-13"]},
  {"journeyId":"LJ-17","legacyJourneyIds":["JRN-18"],"capabilityIds":["CAP-DAT-14","CAP-DAT-15","CAP-DAT-18","CAP-DAT-20"]},
  {"journeyId":"LJ-18","legacyJourneyIds":["JRN-17"],"capabilityIds":["CAP-DAT-13"]},
  {"journeyId":"LJ-19","legacyJourneyIds":["JRN-19"],"capabilityIds":["CAP-DAT-16","CAP-DAT-18"]},
  {"journeyId":"LJ-20","legacyJourneyIds":["JRN-19"],"capabilityIds":["CAP-DAT-17","CAP-DAT-22"]},
  {"journeyId":"SJ-01","legacyJourneyIds":["JRN-02","JRN-03","JRN-07"],"capabilityIds":["CAP-LNG-01","CAP-LNG-02","CAP-LNG-03","CAP-LNG-04","CAP-LNG-05","CAP-LNG-06","CAP-LNG-08"]},
  {"journeyId":"SJ-02","legacyJourneyIds":["JRN-07","JRN-08"],"capabilityIds":["CAP-EXT-02","CAP-EXT-14","CAP-AGT-01","CAP-AGT-02","CAP-AGT-09","CAP-AGT-10","CAP-AGT-11","CAP-AGT-12"]},
  {"journeyId":"SJ-03","legacyJourneyIds":["JRN-03","JRN-07","JRN-10"],"capabilityIds":["CAP-SET-01","CAP-EXT-03","CAP-CSU-12"]},
  {"journeyId":"SJ-04","legacyJourneyIds":["JRN-03"],"capabilityIds":["CAP-APP-01","CAP-APP-02","CAP-APP-03","CAP-LNG-07"]},
  {"journeyId":"OJ-01","legacyJourneyIds":[],"capabilityIds":[],"gap":"Consumer admission evidence does not cover authoring and freezing a candidate; operator scenarios need decomposition."},
  {"journeyId":"OJ-02","legacyJourneyIds":[],"capabilityIds":[],"gap":"Publisher candidate UI has no legacy Capability/Scenario decomposition; it is not public promotion."},
  {"journeyId":"OJ-03","legacyJourneyIds":[],"capabilityIds":["REL-REG-01"]},
  {"journeyId":"OJ-04","legacyJourneyIds":[],"capabilityIds":["CAP-XFN-14","CAP-XFN-15"],"gap":"Legacy external release gates do not cover the complete application candidate/deployment/recovery journey."},
  {"journeyId":"OJ-05","legacyJourneyIds":["JRN-20"],"capabilityIds":["CAP-DAT-19","CAP-XFN-13"]},
];

/** Apply these overlays to applicable phases, not as additional business goals. */
export const crosscuttingCapabilityIds: readonly CapabilityId[] = ["CAP-SHL-07","CAP-SHL-08","CAP-SHL-09","CAP-SHL-10","CAP-XFN-01","CAP-XFN-02","CAP-XFN-03","CAP-XFN-04","CAP-XFN-05","CAP-XFN-06","CAP-XFN-07","CAP-XFN-08","CAP-XFN-09","CAP-XFN-10","CAP-XFN-11","CAP-XFN-12"];

export const auditedCapabilities: readonly Readonly<{
  id: CapabilityId; legacyJourneyIds: readonly LegacyJourneyId[]; baselineScope: string;
}>[] = [
  {"id":"CAP-SHL-01","legacyJourneyIds":["JRN-01"],"baselineScope":"current"},
  {"id":"CAP-SHL-02","legacyJourneyIds":["JRN-01"],"baselineScope":"current"},
  {"id":"CAP-SHL-03","legacyJourneyIds":["JRN-01"],"baselineScope":"current"},
  {"id":"CAP-SHL-04","legacyJourneyIds":["JRN-02"],"baselineScope":"current"},
  {"id":"CAP-SHL-05","legacyJourneyIds":["JRN-02"],"baselineScope":"current"},
  {"id":"CAP-SHL-06","legacyJourneyIds":["JRN-11","JRN-12","JRN-13"],"baselineScope":"current"},
  {"id":"CAP-SHL-07","legacyJourneyIds":["JRN-01","JRN-03"],"baselineScope":"current"},
  {"id":"CAP-SHL-08","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-SHL-10","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-SET-01","legacyJourneyIds":["JRN-03","JRN-04","JRN-10"],"baselineScope":"current"},
  {"id":"CAP-LNG-01","legacyJourneyIds":["JRN-02","JRN-03"],"baselineScope":"current"},
  {"id":"CAP-LNG-02","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-LNG-03","legacyJourneyIds":["JRN-03","JRN-07"],"baselineScope":"current"},
  {"id":"CAP-LNG-04","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-LNG-05","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-LNG-06","legacyJourneyIds":["JRN-03","JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LNG-07","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-LNG-08","legacyJourneyIds":["JRN-03","JRN-07"],"baselineScope":"current"},
  {"id":"CAP-APP-01","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-APP-02","legacyJourneyIds":["JRN-03"],"baselineScope":"current"},
  {"id":"CAP-APP-03","legacyJourneyIds":["JRN-03","JRN-12"],"baselineScope":"current"},
  {"id":"CAP-PSW-01","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-02","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-03","legacyJourneyIds":["JRN-04","JRN-05"],"baselineScope":"current"},
  {"id":"CAP-PSW-04","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-05","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-06","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-07","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-08","legacyJourneyIds":["JRN-05"],"baselineScope":"current"},
  {"id":"CAP-PSW-09","legacyJourneyIds":["JRN-05"],"baselineScope":"current"},
  {"id":"CAP-PSW-10","legacyJourneyIds":["JRN-05"],"baselineScope":"current"},
  {"id":"CAP-PSW-11","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-PSW-12","legacyJourneyIds":["JRN-04","JRN-19"],"baselineScope":"current"},
  {"id":"CAP-PSW-13","legacyJourneyIds":["JRN-06"],"baselineScope":"current"},
  {"id":"CAP-PSW-14","legacyJourneyIds":["JRN-06"],"baselineScope":"current"},
  {"id":"CAP-PSW-15","legacyJourneyIds":["JRN-04"],"baselineScope":"current"},
  {"id":"CAP-PSW-16","legacyJourneyIds":["JRN-04","JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-01","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-02","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-03","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-04","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-05","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-06","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-07","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-08","legacyJourneyIds":["JRN-09"],"baselineScope":"current"},
  {"id":"CAP-CSU-09","legacyJourneyIds":["JRN-09","JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-10","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-11","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-12","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-13","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-CSU-14","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-CSU-15","legacyJourneyIds":["JRN-09","JRN-11"],"baselineScope":"current"},
  {"id":"CAP-LRN-01","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-LRN-02","legacyJourneyIds":["JRN-10","JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-03","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-04","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-05","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-06","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-07","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-08","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-09","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-10","legacyJourneyIds":["JRN-12","JRN-13"],"baselineScope":"current"},
  {"id":"CAP-LRN-11","legacyJourneyIds":["JRN-13"],"baselineScope":"current"},
  {"id":"CAP-LRN-12","legacyJourneyIds":["JRN-13"],"baselineScope":"current"},
  {"id":"CAP-LRN-13","legacyJourneyIds":["JRN-14"],"baselineScope":"current"},
  {"id":"CAP-LRN-14","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-15","legacyJourneyIds":["JRN-12"],"baselineScope":"current"},
  {"id":"CAP-LRN-16","legacyJourneyIds":["JRN-15"],"baselineScope":"current"},
  {"id":"CAP-LRN-17","legacyJourneyIds":["JRN-15"],"baselineScope":"current"},
  {"id":"CAP-LRN-18","legacyJourneyIds":["JRN-16"],"baselineScope":"decision_conflict"},
  {"id":"CAP-LRN-19","legacyJourneyIds":["JRN-16"],"baselineScope":"decision_conflict"},
  {"id":"CAP-LRN-20","legacyJourneyIds":["JRN-10"],"baselineScope":"current"},
  {"id":"CAP-LRN-21","legacyJourneyIds":["JRN-10","JRN-11"],"baselineScope":"current"},
  {"id":"CAP-LRN-22","legacyJourneyIds":["JRN-11"],"baselineScope":"current"},
  {"id":"CAP-LRN-23","legacyJourneyIds":["JRN-12","JRN-14"],"baselineScope":"current"},
  {"id":"CAP-EXT-01","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-02","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-03","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-04","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-05","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-06","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-07","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-08","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-09","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-10","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-11","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-12","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-13","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-14","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-EXT-15","legacyJourneyIds":["JRN-07"],"baselineScope":"current"},
  {"id":"CAP-AGT-01","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-02","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-03","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-04","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-05","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-06","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-07","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-08","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-09","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-10","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-11","legacyJourneyIds":["JRN-08"],"baselineScope":"current"},
  {"id":"CAP-AGT-12","legacyJourneyIds":["JRN-08","JRN-19"],"baselineScope":"decision_undefined"},
  {"id":"CAP-DAT-01","legacyJourneyIds":["JRN-02"],"baselineScope":"current"},
  {"id":"CAP-DAT-02","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-03","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-04","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-05","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-06","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-07","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-08","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-09","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-10","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-11","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-12","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-13","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-14","legacyJourneyIds":["JRN-18"],"baselineScope":"current"},
  {"id":"CAP-DAT-15","legacyJourneyIds":["JRN-18"],"baselineScope":"current"},
  {"id":"CAP-DAT-16","legacyJourneyIds":["JRN-19"],"baselineScope":"current"},
  {"id":"CAP-DAT-17","legacyJourneyIds":["JRN-19"],"baselineScope":"current"},
  {"id":"CAP-DAT-18","legacyJourneyIds":["JRN-18","JRN-19"],"baselineScope":"current"},
  {"id":"CAP-DAT-19","legacyJourneyIds":["JRN-20"],"baselineScope":"current"},
  {"id":"CAP-DAT-20","legacyJourneyIds":["JRN-18"],"baselineScope":"future"},
  {"id":"CAP-DAT-21","legacyJourneyIds":["JRN-17"],"baselineScope":"current"},
  {"id":"CAP-DAT-22","legacyJourneyIds":["JRN-18","JRN-19"],"baselineScope":"current"},
  {"id":"CAP-DAT-23","legacyJourneyIds":["JRN-02","JRN-18"],"baselineScope":"current"},
  {"id":"CAP-SHL-09","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-01","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-02","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-03","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-04","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-05","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-06","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-07","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-08","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-09","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-10","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-11","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-12","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-13","legacyJourneyIds":[],"baselineScope":"current"},
  {"id":"CAP-XFN-14","legacyJourneyIds":[],"baselineScope":"external-gate"},
  {"id":"CAP-XFN-15","legacyJourneyIds":[],"baselineScope":"external-gate"},
  {"id":"REL-REG-01","legacyJourneyIds":[],"baselineScope":"external-gate"},
];

export const auditedScenarios: readonly Readonly<{
  id: ScenarioId; capabilityIds: readonly CapabilityId[]; branches: readonly string[];
  phase: string; auditOracle: string; minimumLayers: readonly EvidenceLayer[];
  baselineVerdict: string; issueIds: readonly string[];
}>[] = [
  {"id":"SCN-SHL-001","capabilityIds":["CAP-SHL-01","CAP-SHL-02","CAP-SHL-03"],"branches":["H"],"auditOracle":"新浏览器分别打开 `/`、`/welcome`、`/how-it-works`；页面公开可读、内容对应真实产品，CTA 能进入正确下一步","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"entry"},
  {"id":"SCN-SHL-002","capabilityIds":["CAP-SHL-01","CAP-SHL-02","CAP-SHL-03","CAP-LNG-07"],"branches":["A"],"auditOracle":"在公开页面切换 locale 并刷新；文案与 `html lang/dir` 一致，路由和 CTA 不丢失","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"entry"},
  {"id":"SCN-SHL-003","capabilityIds":["CAP-SHL-10"],"branches":["F","R"],"auditOracle":"打开未知 URL 或触发渲染错误；不出现伪登录/假数据，可返回安全首页或重试且本机库不丢失","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"entry"},
  {"id":"SCN-LOCAL-001","capabilityIds":["CAP-SHL-04","CAP-DAT-01"],"branches":["H"],"auditOracle":"无库、未登录用户从公开 CTA 建立本机库；App Shell 可用，刷新后事实仍存在","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"local-library"},
  {"id":"SCN-LOCAL-002","capabilityIds":["CAP-SHL-05","CAP-DAT-01"],"branches":["H"],"auditOracle":"已有本机库重新打开 `/`；无需等待账号恢复即可进入 Home 并使用本机能力","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"local-library"},
  {"id":"SCN-LOCAL-003","capabilityIds":["CAP-SHL-04","CAP-DAT-01"],"branches":["F"],"auditOracle":"OPFS/SQLite 初始化不可用、quota 或 schema 打开失败；显示真实错误与安全恢复，不创建假空库","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"local-library"},
  {"id":"SCN-LOCAL-004","capabilityIds":["CAP-DAT-23"],"branches":["H","A"],"auditOracle":"查看 persistent/best-effort/unsupported/unavailable；申请被拒时仍说明驱逐风险和“不是备份”","minimumLayers":["browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"local-library"},
  {"id":"SCN-NAV-001","capabilityIds":["CAP-SHL-07"],"branches":["H"],"auditOracle":"在 Home、语义世界、学习、设置间切换；目的页正确，focused learning 按要求隐藏 chrome，返回后状态保留","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"navigation"},
  {"id":"SCN-NAV-002","capabilityIds":["CAP-SHL-08"],"branches":["H","R"],"auditOracle":"直接打开合法深链，刷新、back/forward、新标签打开；恢复同一 screen、sheet 和参数","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"navigation"},
  {"id":"SCN-NAV-003","capabilityIds":["CAP-SHL-08","CAP-SHL-10"],"branches":["F"],"auditOracle":"非法参数、未知 screen 或失效对象；显示 not-found/recovery，不污染历史栈或本机事实","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"navigation"},
  {"id":"SCN-SET-001","capabilityIds":["CAP-LNG-01"],"branches":["H","D"],"auditOracle":"创建有效 route；重复 pair 幂等或明确拒绝，无效 tag 不落库，新 route 不迁移旧历史","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-002","capabilityIds":["CAP-LNG-02","CAP-LNG-03"],"branches":["H","A"],"auditOracle":"Web 切 route，Extension active route 保持独立；活动 Run/历史仍属于原 route","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-003","capabilityIds":["CAP-LNG-04","CAP-LNG-05"],"branches":["H","A"],"auditOracle":"修改 support language、暂停/恢复/归档 route；仅影响后续入口，历史保留，最后 active guard 生效","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-004","capabilityIds":["CAP-LNG-06"],"branches":["H","A"],"auditOracle":"设置每日新内容数量；新 Session 使用 route quota，due review 不被截断，活动 Session 不变化","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-005","capabilityIds":["CAP-LNG-07"],"branches":["H","A"],"auditOracle":"浏览器 locale 回退及设置切换覆盖全部支持 locale；刷新后保持，不改变学习路线","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-006","capabilityIds":["CAP-LNG-08"],"branches":["H","D"],"auditOracle":"Web 编辑方向性 glossary；Extension 只按精确 input/output pair 使用，反向不复用且不产生学习事实","minimumLayers":["integration","extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-007","capabilityIds":["CAP-APP-01","CAP-APP-02"],"branches":["H","A"],"auditOracle":"切换 Skin、color mode、文字大小；即时生效、离线/刷新保持，缺失 Skin 安全 fallback","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-008","capabilityIds":["CAP-APP-03"],"branches":["D"],"auditOracle":"外观切换前后 route、draft、focus、scroll 与活动 Run 完全不变","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-009","capabilityIds":["CAP-SET-01"],"branches":["H"],"auditOracle":"游客配置本机模型、登录用户配置账号连接并按用途指派；UI 明示执行位置，key 不回显","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-SET-010","capabilityIds":["CAP-SET-01"],"branches":["F","R"],"auditOracle":"provider 不可用、配置错误或请求失败；个人内容保留为草稿/待处理，修复后可继续","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"configuration"},
  {"id":"SCN-PSW-001","capabilityIds":["CAP-PSW-01","CAP-PSW-03"],"branches":["H"],"auditOracle":"从空白 Talk to Sensa 输入真实经历；教师自然回复、只追问缺失事实并保存可恢复草稿","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-002","capabilityIds":["CAP-PSW-02","CAP-PSW-03"],"branches":["H"],"auditOracle":"场景编辑器提交文字、图片或熟悉表达；可保存 Inbox 或进入同一澄清 loop","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-003","capabilityIds":["CAP-PSW-03"],"branches":["F","I","R"],"auditOracle":"模型失败、流中断、格式无效、关闭再打开；已输入内容不丢，显示真实未完成状态并可继续","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-004","capabilityIds":["CAP-PSW-04"],"branches":["H","A"],"auditOracle":"Context/Sense/Expression 足够时形成完整候选；Focus 可选，不完整候选不展示为可接受","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-005","capabilityIds":["CAP-PSW-05"],"branches":["H"],"auditOracle":"用户在 UI 明确确认候选；Personal Meaning 原子写入且能从语义世界再次打开","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-006","capabilityIds":["CAP-PSW-05"],"branches":["D","F"],"auditOracle":"重复确认、候选变化、commit 失败；最多产生一个等价 Meaning，失败不显示成功","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-007","capabilityIds":["CAP-PSW-06"],"branches":["H"],"auditOracle":"正常 Meaning 详情展示 Context、Sense、图片、来源、笔记、资源和 Add-to-Learning，不重启澄清","minimumLayers":["browser"],"baselineVerdict":"false-scope（ISSUE-006 仍阻断实现）","issueIds":["ISSUE-006"],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-008","capabilityIds":["CAP-PSW-07"],"branches":["H","D"],"auditOracle":"编辑 Context 产生新 revision；stale revision 明确冲突，媒体限制生效，旧 provenance 保留","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-009","capabilityIds":["CAP-PSW-12"],"branches":["H","D"],"auditOracle":"明确删除 Meaning 后生成 durable tombstone；旧离线副本不能复活，学习历史不级联删除","minimumLayers":["integration","browser-db"],"baselineVerdict":"blocked:ISSUE-029","issueIds":["ISSUE-029"],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-010","capabilityIds":["CAP-PSW-15"],"branches":["H","D"],"auditOracle":"接受后纠正 Expression/Alignment；Sense revision/split/relation 可追溯，binding 改变不改写旧 Target","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-030","issueIds":["ISSUE-030"],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-011","capabilityIds":["CAP-PSW-03","CAP-SHL-09"],"branches":["F","R"],"auditOracle":"clarification session 存储写失败；UI 明示未保存并保护输入，刷新后不冒充可恢复","minimumLayers":["browser"],"baselineVerdict":"adequate","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-012","capabilityIds":["CAP-PSW-03","CAP-SHL-09"],"branches":["D"],"auditOracle":"两标签页并发修改会合并或显式冲突，不静默覆盖另一页会话","minimumLayers":["browser"],"baselineVerdict":"adequate","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-PSW-013","capabilityIds":["CAP-PSW-02"],"branches":["F","R","D"],"auditOracle":"多图片逐项提交中途失败；重试只补未提交图片并显示各项状态，不重复附加","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"semantic-intake-and-governance"},
  {"id":"SCN-INBOX-001","capabilityIds":["CAP-PSW-08"],"branches":["H"],"auditOracle":"打开不同来源 Inbox item；展示已知 Context、Expression、来源和媒体本体及缺失状态","minimumLayers":["browser"],"baselineVerdict":"blocked:ISSUE-019","issueIds":["ISSUE-019"],"phase":"inbox-resolution"},
  {"id":"SCN-INBOX-002","capabilityIds":["CAP-PSW-09"],"branches":["H"],"auditOracle":"补齐缺失事实并确认；原子产生 Meaning，Inbox item 进入正确终态","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"inbox-resolution"},
  {"id":"SCN-INBOX-003","capabilityIds":["CAP-PSW-09"],"branches":["I","R","D"],"auditOracle":"补全中刷新、重复提交或 commit 响应丢失；恢复同一 item，最多产生一个 Meaning","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"inbox-resolution"},
  {"id":"SCN-INBOX-004","capabilityIds":["CAP-PSW-10"],"branches":["H","F","D"],"auditOracle":"明确丢弃后只删除目标 item/draft；失败或重复不影响其它 Inbox 内容","minimumLayers":["integration","browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"inbox-resolution"},
  {"id":"SCN-REF-001","capabilityIds":["CAP-PSW-13"],"branches":["H","D"],"auditOracle":"收藏/取消收藏 Sense 或 Example；列表可再次找到，重复动作幂等且不创建 Meaning/Membership","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"reference"},
  {"id":"SCN-REF-002","capabilityIds":["CAP-PSW-13"],"branches":["H","F"],"auditOracle":"创建、编辑、删除 Note；刷新和同步后内容正确，失败不伪装保存","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"reference"},
  {"id":"SCN-REF-003","capabilityIds":["CAP-PSW-14"],"branches":["H","A"],"auditOracle":"全局查词返回固定 Reference Release 的完整词条；点击例句精确位置解析对应片段","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"reference"},
  {"id":"SCN-REF-004","capabilityIds":["CAP-PSW-14"],"branches":["A","F"],"auditOracle":"含义不确定时标示“可能是”或不强调义项；无结果/离线有真实出口，查询不改变进度","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"reference"},
  {"id":"SCN-MAT-001","capabilityIds":["CAP-PSW-16"],"branches":["H","F"],"auditOracle":"Context 新 revision 后用户显式请求更新材料；失败保留旧材料，成功只影响兼容未操作步骤","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-031","issueIds":["ISSUE-031"],"phase":"material-update"},
  {"id":"SCN-CAT-001","capabilityIds":["CAP-CSU-01"],"branches":["H","A"],"auditOracle":"未登录用户打开学习包；先显示可信缓存并低频刷新，公开 Catalog 可浏览","minimumLayers":["browser"],"baselineVerdict":"blocked:ISSUE-027","issueIds":["ISSUE-027"],"phase":"discovery"},
  {"id":"SCN-CAT-002","capabilityIds":["CAP-CSU-01"],"branches":["F","R"],"auditOracle":"无缓存离线、ETag 未变、缓存过期或刷新失败；区分空目录与失败并提供重试","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"discovery"},
  {"id":"SCN-CAT-003","capabilityIds":["CAP-CSU-02"],"branches":["H","A"],"auditOracle":"按当前 route 打开稳定 Book，看到版本与变更摘要；route 不匹配或无版本有明确状态","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"discovery"},
  {"id":"SCN-BOOK-001","capabilityIds":["CAP-CSU-03"],"branches":["H"],"auditOracle":"Book 的 Manifest 与全部成员通过大小、digest、合同、route 校验后一次提交","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-003","issueIds":["ISSUE-003"],"phase":"atomic-installation"},
  {"id":"SCN-BOOK-002","capabilityIds":["CAP-CSU-03"],"branches":["F","R"],"auditOracle":"第 N 个成员失败、取消或重试；不留下部分安装/混合 enrollment，原版本仍可用","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-003","issueIds":["ISSUE-003"],"phase":"installation-recovery"},
  {"id":"SCN-BOOK-003","capabilityIds":["CAP-CSU-04"],"branches":["H","D"],"auditOracle":"下载后仍无 Target；明确加入才创建 enrollment，重复加入幂等，route mismatch 明确拒绝","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"explicit-enrollment"},
  {"id":"SCN-BOOK-004","capabilityIds":["CAP-CSU-05"],"branches":["H"],"auditOracle":"同一 stable Book 的新版可发现、下载、预览并由用户明确应用","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-002","issueIds":["ISSUE-002"],"phase":"version-discovery"},
  {"id":"SCN-BOOK-005","capabilityIds":["CAP-CSU-05"],"branches":["A","I"],"auditOracle":"新版增删成员或活动 Run 存在；Target identity 按规则稳定/变化，进行中 Run 不静默换材料","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-002+ISSUE-003","issueIds":["ISSUE-002","ISSUE-003"],"phase":"version-application"},
  {"id":"SCN-PKG-001","capabilityIds":["CAP-CSU-06"],"branches":["H","F"],"auditOracle":"选择 `.sensa` 先只读预览 title/route/expression/sense/author/license；损坏或超限零写入","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"preview"},
  {"id":"SCN-PKG-002","capabilityIds":["CAP-CSU-07"],"branches":["H","D"],"auditOracle":"明确确认后本机安装；route mismatch 仍可存，相同内容幂等，identity 内容冲突拒绝","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"installation"},
  {"id":"SCN-PKG-003","capabilityIds":["CAP-CSU-08"],"branches":["H","A"],"auditOracle":"更高 Portable 版本显示待应用；显式应用后同 identity 保留进度，不同 identity 新建 Target","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"version-application"},
  {"id":"SCN-PKG-004","capabilityIds":["CAP-CSU-09"],"branches":["H","F"],"auditOracle":"导出合格 `.sensa`；不含进度/Evidence/调度，未 ready 或无授权时拒绝","minimumLayers":["contract","integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"export"},
  {"id":"SCN-ENROLL-001","capabilityIds":["CAP-CSU-15"],"branches":["H","A"],"auditOracle":"切换 active Book、调整 Range、进入 maintenance/paused，再恢复；旧历史和复习保留","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"learning-scope"},
  {"id":"SCN-ENROLL-002","capabilityIds":["CAP-CSU-15"],"branches":["I"],"auditOracle":"切换或暂停时已有 Session；不静默改队，已开始 Run 继续使用固定 scope/material","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"learning-scope"},
  {"id":"SCN-ADD-001","capabilityIds":["CAP-PSW-11","CAP-LRN-01"],"branches":["H"],"auditOracle":"从已接受 Meaning 明确 Add-to-Learning；Intent/Membership 立即持久存在并显示 preparing/ready/blocked","minimumLayers":["browser"],"baselineVerdict":"blocked:ISSUE-004+ISSUE-006","issueIds":["ISSUE-004","ISSUE-006"],"phase":"explicit-learning-intent"},
  {"id":"SCN-ADD-002","capabilityIds":["CAP-LRN-20"],"branches":["H"],"auditOracle":"从 stable Sense 直接加入固定 route；不创建 Personal Meaning，显示真实准备状态","minimumLayers":["browser"],"baselineVerdict":"blocked:ISSUE-032","issueIds":["ISSUE-032"],"phase":"explicit-learning-intent"},
  {"id":"SCN-ADD-003","capabilityIds":["CAP-LRN-01"],"branches":["F","R","D"],"auditOracle":"provisioning 失败、关闭、重复点击或响应丢失；Membership 保留且最多一个，之后可恢复","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-004","issueIds":["ISSUE-004"],"phase":"explicit-learning-intent"},
  {"id":"SCN-ADD-004","capabilityIds":["CAP-LRN-21"],"branches":["H","D"],"auditOracle":"移除 Supplemental Membership 后新 Study Scope 生效；无其它来源时退出未来 planning，重加沿原状态继续","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-033","issueIds":["ISSUE-033"],"phase":"explicit-learning-intent"},
  {"id":"SCN-PROV-001","capabilityIds":["CAP-CSU-10"],"branches":["H"],"auditOracle":"Task 经 queued/preparing/submitted/validating 到 ready；每次 Attempt 与固定输入可追溯","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-005","issueIds":["ISSUE-005"],"phase":"preparation"},
  {"id":"SCN-PROV-002","capabilityIds":["CAP-CSU-10"],"branches":["F","R"],"auditOracle":"Attempt 超时/失败/取消/rejected；旧 Attempt 终态，新 Attempt 重试，Task 显示 blocked/cancelled 原因","minimumLayers":["integration","browser"],"baselineVerdict":"blocked:ISSUE-005","issueIds":["ISSUE-005"],"phase":"preparation"},
  {"id":"SCN-PROV-003","capabilityIds":["CAP-CSU-11"],"branches":["H","A"],"auditOracle":"用户选择是否授权 Context；未授权仍可按 Sense/Binding 准备，授权范围后续更新不改写旧材料","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"preparation"},
  {"id":"SCN-PROV-004","capabilityIds":["CAP-CSU-12"],"branches":["H","F"],"auditOracle":"精确 TTS/媒体存在才 ready；provider/语言/媒体失败时保持 blocked，不制造资源","minimumLayers":["integration"],"baselineVerdict":"partial","issueIds":[],"phase":"preparation"},
  {"id":"SCN-PROV-005","capabilityIds":["CAP-CSU-14"],"branches":["H","F"],"auditOracle":"固定 Published base digest 与 approved supplement 形成新 immutable materialization；补件失败保留 base","minimumLayers":["integration"],"baselineVerdict":"partial","issueIds":[],"phase":"preparation"},
  {"id":"SCN-READY-001","capabilityIds":["CAP-LRN-02","CAP-SHL-06"],"branches":["H","F"],"auditOracle":"持久化 Target/Policy/content 驱动 Home 的 ready/blocked；缺资源、损坏和协议缺失显示真实原因","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"readiness"},
  {"id":"SCN-STUDY-OVERVIEW-001","capabilityIds":["CAP-LRN-22","CAP-SHL-06"],"branches":["H","A"],"auditOracle":"“我的学习”展示目标与准备原因；空态、筛选无结果、目标打开均正确","minimumLayers":["browser"],"baselineVerdict":"none","issueIds":[],"phase":"learning-management"},
  {"id":"SCN-STUDY-OVERVIEW-002","capabilityIds":["CAP-LRN-22"],"branches":["H","A"],"auditOracle":"历史和统计按类型/日期/语言筛选，记录可返回对应目标，范围无效有明确状态","minimumLayers":["browser"],"baselineVerdict":"none","issueIds":[],"phase":"learning-management"},
  {"id":"SCN-STUDY-OVERVIEW-003","capabilityIds":["CAP-CSU-15","CAP-LRN-21","CAP-LRN-22"],"branches":["H"],"auditOracle":"从“我的学习”管理 Enrollment/Membership，操作后列表与下一次 planning 一致","minimumLayers":["browser"],"baselineVerdict":"none","issueIds":[],"phase":"learning-management"},
  {"id":"SCN-LEARN-001","capabilityIds":["CAP-LRN-03"],"branches":["H","F"],"auditOracle":"未开始 Target 选择方法；首个 Run 固定 Policy，开始后禁止静默迁移","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"policy-commitment"},
  {"id":"SCN-LEARN-002","capabilityIds":["CAP-LRN-04"],"branches":["H","A"],"auditOracle":"Home 规划 mixed/review-only Session；遵守新内容额度且不截断 due/relearning","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"task-dispatch"},
  {"id":"SCN-LEARN-003","capabilityIds":["CAP-LRN-05"],"branches":["H"],"auditOracle":"用户通过 recall→reveal→rating→completion；每步可见且合法完成","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"initial-learning"},
  {"id":"SCN-LEARN-004","capabilityIds":["CAP-LRN-06"],"branches":["H","F","R"],"auditOracle":"Structured Acquisition 经 gates、targeted repair、independent retest 后才毕业","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"structured-acquisition"},
  {"id":"SCN-LEARN-005","capabilityIds":["CAP-LRN-07"],"branches":["I","R","D"],"auditOracle":"刷新、关闭、Worker 重启或重复 Action；恢复同一 Run/Step/material，revision conflict 可处理","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"runtime-recovery"},
  {"id":"SCN-LEARN-006","capabilityIds":["CAP-LRN-08"],"branches":["A","D"],"auditOracle":"显式应用兼容材料后只刷新未操作 Step；已操作/当前 Step 固定，identity 变化走新 Target","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"material-update"},
  {"id":"SCN-LEARN-007","capabilityIds":["CAP-LRN-09","CAP-LRN-10","CAP-XFN-01"],"branches":["H","F","D"],"auditOracle":"只有合格 Observation 产生一次 Evidence/Completion/Scheduling；写失败、replay、并发不显示假成功","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"settlement"},
  {"id":"SCN-LEARN-008","capabilityIds":["CAP-LRN-14"],"branches":["H","A"],"auditOracle":"reveal 只展示已 ready 的声音、释义、例句、辨析、构词、词源、助记；查询保持只读","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"resource-reveal"},
  {"id":"SCN-LEARN-009","capabilityIds":["CAP-LRN-15"],"branches":["H","F"],"auditOracle":"reveal 中提问得到不阻断学习的回答；离线/失败/切 Target 不写回学习事实","minimumLayers":["browser"],"baselineVerdict":"blocked:ISSUE-007","issueIds":["ISSUE-007"],"phase":"learning-question"},
  {"id":"SCN-LEARN-010","capabilityIds":["CAP-LRN-23"],"branches":["H","F"],"auditOracle":"Encounter 按 planned→active→completed/interrupted/cancelled；非 completed 不产生 Outcome/Evidence","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"encounter-lifecycle"},
  {"id":"SCN-REVIEW-001","capabilityIds":["CAP-LRN-11"],"branches":["H","A"],"auditOracle":"due Target 完成 review 并结算唯一 Memory Outcome；early/review-only 按规则处理","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"review"},
  {"id":"SCN-REVIEW-002","capabilityIds":["CAP-LRN-12"],"branches":["F","R"],"auditOracle":"review/gate 失败进入 repair/relearning；不重复原 review settlement，不重置 FSRS","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"relearning"},
  {"id":"SCN-REVIEW-003","capabilityIds":["CAP-LRN-10","CAP-LRN-11","CAP-LRN-12"],"branches":["D"],"auditOracle":"finish/review/relearning replay、并发或响应丢失；调度贡献和 memory revision 仍唯一","minimumLayers":["integration"],"baselineVerdict":"partial","issueIds":[],"phase":"settlement-replay"},
  {"id":"SCN-MASTERED-001","capabilityIds":["CAP-LRN-13","CAP-LRN-23"],"branches":["H"],"auditOracle":"活动 Run 中声明已会；相关未终止 Encounter 正确结束，目标退出 planning 并继续下一项","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"planning-override"},
  {"id":"SCN-MASTERED-002","capabilityIds":["CAP-LRN-13"],"branches":["A"],"auditOracle":"无下一目标时显示真实结束状态，不创建虚假 completion 或空 Run","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"planning-override"},
  {"id":"SCN-MASTERED-003","capabilityIds":["CAP-LRN-13","CAP-LRN-23"],"branches":["R","D"],"auditOracle":"撤销 override 只恢复计划资格；用户明确重启时才产生配对 Run-resume fact","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"planning-override"},
  {"id":"SCN-SCENE-001","capabilityIds":["CAP-LRN-16"],"branches":["H"],"auditOracle":"仅 Package 首次经验步骤创建文字/图片 Scene revision，保存后可再次编辑","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"personal-scene"},
  {"id":"SCN-SCENE-002","capabilityIds":["CAP-LRN-17"],"branches":["H","F"],"auditOracle":"reveal 中明确 direct acceptance 后复用同一 Meaning/Target；未修改或失败不产生重复身份","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"personal-scene"},
  {"id":"SCN-SCENE-003","capabilityIds":["CAP-LRN-08","CAP-LRN-16"],"branches":["D"],"auditOracle":"Scene/material 更新不改变已操作 Step，后续兼容 Step 才使用新 revision","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"personal-scene"},
  {"id":"SCN-EXT-001","capabilityIds":["CAP-EXT-01"],"branches":["H","A"],"auditOracle":"未登录扩展在本机完成阅读、朗读和保存原文；无模型或 Web 未打开时状态真实","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-002","capabilityIds":["CAP-EXT-02"],"branches":["H","F","D"],"auditOracle":"Popup 经 Web tab + bridge 授权；state/PKCE、重放、过期、切换账号、断开均有正确出口","minimumLayers":["extension-browser","browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-003","capabilityIds":["CAP-EXT-03"],"branches":["H","F","D"],"auditOracle":"Options 配置 provider/用途；permission/CAS 冲突可恢复，无 provider 不冒充可用，key 不回显","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-004","capabilityIds":["CAP-EXT-04","CAP-LNG-03","CAP-LNG-08","CAP-XFN-08"],"branches":["H","A"],"auditOracle":"整页可见块按实际语言翻译；已会语言跳过，第三语言用自身 input language，glossary 方向精确","minimumLayers":["extension-browser"],"baselineVerdict":"blocked:ISSUE-008","issueIds":["ISSUE-008"],"phase":"extension-entry"},
  {"id":"SCN-EXT-005","capabilityIds":["CAP-EXT-04"],"branches":["I","R"],"auditOracle":"动态内容、流取消、重试、切 route；旧结果不覆盖新页面，未完成块不显示成功","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-006","capabilityIds":["CAP-EXT-05"],"branches":["H","F"],"auditOracle":"合法 selection 得到翻译/解释/句中意义；无效选区、Context 变化和取消有真实状态","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-007","capabilityIds":["CAP-EXT-06"],"branches":["H","A"],"auditOracle":"完整 lookup 候选经用户确认成为 complete Intake；不完整候选只能待处理或拒绝","minimumLayers":["extension-browser","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-008","capabilityIds":["CAP-EXT-07"],"branches":["H","F"],"auditOracle":"editable field 以 Alt+T 请求翻译，先预览后替换；password/readonly/disabled 禁止，Escape 取消","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-009","capabilityIds":["CAP-EXT-08"],"branches":["H","A","F"],"auditOracle":"整页/选区只用匹配语言的本机声音朗读；无文字/未知语言/无 voice/停止有明确出口","minimumLayers":["extension-browser"],"baselineVerdict":"blocked:ISSUE-011","issueIds":["ISSUE-011"],"phase":"extension-entry"},
  {"id":"SCN-EXT-010","capabilityIds":["CAP-EXT-09"],"branches":["H","A","I"],"auditOracle":"使用实际字幕轨或本机字幕文件形成 cue；非英语、直播、换视频、文件过大不串状态","minimumLayers":["extension-browser"],"baselineVerdict":"blocked:ISSUE-009","issueIds":["ISSUE-009"],"phase":"extension-entry"},
  {"id":"SCN-EXT-011","capabilityIds":["CAP-EXT-10"],"branches":["H","D"],"auditOracle":"禁用当前站点后页面立即停止；Popup 可解除，hostname/子域/不支持 URL 规则一致","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-012","capabilityIds":["CAP-EXT-11"],"branches":["H","F","D"],"auditOracle":"account/guest 队列持久保存且彼此隔离；容量、坏记录、旧格式不静默丢 owner data","minimumLayers":["integration","extension-browser"],"baselineVerdict":"adequate","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-013","capabilityIds":["CAP-EXT-12","CAP-EXT-13"],"branches":["H","D","R"],"auditOracle":"Web pull 后仅本机 submit 成功才 ack；ACK 丢失/digest/library mismatch 重放可恢复，queued 最终有 receipt","minimumLayers":["extension-browser","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-014","capabilityIds":["CAP-EXT-13"],"branches":["F"],"auditOracle":"Web 关闭、断网或回执未知；Popup/reading panel 只显示 queued/unknown，不显示已保存","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-015","capabilityIds":["CAP-EXT-14"],"branches":["H","N"],"auditOracle":"Popup/Options 在 busy/错误/键盘/窄屏下仍可管理 route、连接、规则、voice 和最近保存","minimumLayers":["extension-browser"],"baselineVerdict":"partial","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-EXT-016","capabilityIds":["CAP-EXT-15"],"branches":["N","D"],"auditOracle":"未开启阅读或主动操作时不读取页面、不调用模型、不扫浏览历史；启用后只处理当前页面","minimumLayers":["extension-browser"],"baselineVerdict":"none","issueIds":[],"phase":"extension-entry"},
  {"id":"SCN-AGT-001","capabilityIds":["CAP-AGT-01"],"branches":["H","F","D"],"auditOracle":"已登录用户创建 10 分钟一次性 setup code；重复、过期、未登录均安全且可解释","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"setup"},
  {"id":"SCN-AGT-002","capabilityIds":["CAP-AGT-02"],"branches":["H"],"auditOracle":"安装命令兑换 token 并原子写入 MCP/Skill/CLI 配置，旧连接只在新凭据安全后撤销","minimumLayers":["integration","database"],"baselineVerdict":"blocked:ISSUE-012","issueIds":["ISSUE-012"],"phase":"installation"},
  {"id":"SCN-AGT-003","capabilityIds":["CAP-AGT-02"],"branches":["I","R","D"],"auditOracle":"exchange 响应丢失、落盘失败或 replacement 重试；用户可恢复，不留下无凭据且旧连接已失效的窗口","minimumLayers":["integration","database"],"baselineVerdict":"blocked:ISSUE-012","issueIds":["ISSUE-012"],"phase":"installation-recovery"},
  {"id":"SCN-AGT-004","capabilityIds":["CAP-AGT-03","CAP-AGT-04"],"branches":["H","F"],"auditOracle":"MCP prompt/tool 和 CLI 的 save、receipt 返回稳定合同；schema、输入上限和命令错误可理解","minimumLayers":["contract","integration"],"baselineVerdict":"partial","issueIds":[],"phase":"agent-entry"},
  {"id":"SCN-AGT-005","capabilityIds":["CAP-AGT-05","CAP-AGT-08"],"branches":["N","A"],"auditOracle":"认证连接只能提交 delegated acceptance，且只能读取自身 receipt；不能伪造 actor/library/acceptance 或读取 PSW","minimumLayers":["contract","database"],"baselineVerdict":"partial","issueIds":[],"phase":"agent-entry"},
  {"id":"SCN-AGT-006","capabilityIds":["CAP-AGT-06"],"branches":["H","F","D"],"auditOracle":"API durable persist 后才返回 queued；无 channel、限流、重复 operation 与 payload conflict 正确处理","minimumLayers":["database"],"baselineVerdict":"adequate","issueIds":[],"phase":"durable-queue"},
  {"id":"SCN-AGT-007","capabilityIds":["CAP-AGT-07"],"branches":["H","R","D"],"auditOracle":"Web online 拉取 delivery，本机 fast-track/Inbox commit 后 ack applied；重开和 ACK 丢失可幂等恢复","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"local-application-and-ack"},
  {"id":"SCN-AGT-008","capabilityIds":["CAP-AGT-09"],"branches":["H","D"],"auditOracle":"查看 active/expired/revoked/last-used；replacement 原子，撤销和重复请求保留审计","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"agent-entry"},
  {"id":"SCN-AGT-009","capabilityIds":["CAP-AGT-10"],"branches":["H","F"],"auditOracle":"卸载只删除精确 managed 资产；同名用户配置保留，离线和远端仍 active 有明确说明","minimumLayers":["integration"],"baselineVerdict":"blocked:ISSUE-034","issueIds":["ISSUE-034"],"phase":"agent-entry"},
  {"id":"SCN-AGT-010","capabilityIds":["CAP-AGT-11"],"branches":["H","F","R"],"auditOracle":"library identity 变化时用户显式重登记目的地；409 可见，旧 queued item 处置明确","minimumLayers":["browser-db"],"baselineVerdict":"blocked:ISSUE-014","issueIds":["ISSUE-014"],"phase":"agent-entry"},
  {"id":"SCN-AUTH-001","capabilityIds":["CAP-DAT-02"],"branches":["H","F"],"auditOracle":"邮箱链接或验证码建立 session；错码、过期、限流、重发后旧邮件均有恢复出口","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"authentication"},
  {"id":"SCN-AUTH-002","capabilityIds":["CAP-DAT-02"],"branches":["A"],"auditOracle":"链接在另一浏览器打开；说明需使用发起浏览器/最新邮件，并提供重发或验证码，不误示登录","minimumLayers":["browser-db"],"baselineVerdict":"none","issueIds":[],"phase":"authentication"},
  {"id":"SCN-CONNECT-001","capabilityIds":["CAP-DAT-03"],"branches":["H","I"],"auditOracle":"本机有、云端空：显式绑定后上传；head 检查后产生的新本机事实仍被保留","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"account-connection"},
  {"id":"SCN-CONNECT-002","capabilityIds":["CAP-DAT-04"],"branches":["H","F","R"],"auditOracle":"本机空、云端有：Shell 可用并后台恢复；进度/失败只在设置数据区，重试不显示假零","minimumLayers":["browser-db"],"baselineVerdict":"blocked:ISSUE-001","issueIds":["ISSUE-001"],"phase":"account-connection"},
  {"id":"SCN-CONNECT-003","capabilityIds":["CAP-DAT-05"],"branches":["A"],"auditOracle":"两端都有：保留两份并停止自动绑定；用户可先导出本机，再明确清除后重连","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"account-connection"},
  {"id":"SCN-CONNECT-004","capabilityIds":["CAP-DAT-06"],"branches":["H","D"],"auditOracle":"两端皆空：形成稳定空库，不上传 bootstrap 噪声；重试和账号切换仍稳定","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"account-connection"},
  {"id":"SCN-CONNECT-005","capabilityIds":["CAP-DAT-21"],"branches":["F"],"auditOracle":"已绑定账号 A 的库登录账号 B；不自动认领/上传，停止账号服务或要求显式处理，两份数据保留","minimumLayers":["browser-db"],"baselineVerdict":"none","issueIds":[],"phase":"account-connection"},
  {"id":"SCN-SYNC-001","capabilityIds":["CAP-DAT-07","CAP-CSU-13"],"branches":["H","F","R"],"auditOracle":"新设备从 head/blocks 恢复 owner facts 与基线，再按精确 digest 重取公共资源；缺 block/资源时显示 blocked","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-002","capabilityIds":["CAP-DAT-08"],"branches":["H","D"],"auditOracle":"pending facts 只在 idle/5min/session/hidden/online/manual 触发 checkpoint；无 pending 不传整库，期间新写入不丢","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-003","capabilityIds":["CAP-DAT-09"],"branches":["F","R"],"auditOracle":"离线/瞬态失败保留本机并按策略退避；终止失败停止重试且可手动恢复","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-004","capabilityIds":["CAP-DAT-10"],"branches":["D","R"],"auditOracle":"commit 成功但 ACK 丢失；同 operation 重试不重复 revision，也不覆盖之后的新本机事实","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-005","capabilityIds":["CAP-DAT-11"],"branches":["D"],"auditOracle":"多设备独立修改收敛；同记录分叉、delete-vs-edit、remote head 变化进入显式裁决","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-006","capabilityIds":["CAP-DAT-12"],"branches":["D"],"auditOracle":"并发 Runs/Events 全部保留，Learning history 使用专用 reconciliation，调度贡献唯一","minimumLayers":["integration","browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-SYNC-007","capabilityIds":["CAP-DAT-13"],"branches":["H","F"],"auditOracle":"Sign out 停止在线服务但本机学习继续；pending sync、失败、重登或换账号均有真实状态","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"synchronization"},
  {"id":"SCN-BACKUP-001","capabilityIds":["CAP-DAT-14"],"branches":["H","F"],"auditOracle":"输入合格密码导出 `.sensa-backup` 和摘要；弱密码、上限、校验失败零成功，敏感字段按规则排除","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"backup-and-restore"},
  {"id":"SCN-BACKUP-002","capabilityIds":["CAP-DAT-14","CAP-DAT-15"],"branches":["H"],"auditOracle":"备份覆盖所有 learner-owned facts、私有材料、媒体和学习历史；公共缓存/设备偏好按规则排除或重取","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"backup-and-restore"},
  {"id":"SCN-BACKUP-003","capabilityIds":["CAP-DAT-15"],"branches":["H"],"auditOracle":"空库 inspect 后原子 restore、reload，并按清单核对 identity、个人内容、媒体和学习事实","minimumLayers":["browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"backup-and-restore"},
  {"id":"SCN-BACKUP-004","capabilityIds":["CAP-DAT-15"],"branches":["F"],"auditOracle":"错密码、篡改、账号 mismatch、非空库或恢复竞态；原库不变并给出真实原因","minimumLayers":["integration","browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"backup-and-restore"},
  {"id":"SCN-BACKUP-005","capabilityIds":["CAP-DAT-15","CAP-XFN-01"],"branches":["F","R"],"auditOracle":"restore 事务已提交但资源模块加载失败；显示“数据已恢复、资源重取失败”，重开可继续","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"backup-and-restore"},
  {"id":"SCN-DATA-001","capabilityIds":["CAP-DAT-18"],"branches":["H","A","F"],"auditOracle":"展示本机/云端 used/capacity/warning；unknown、80%、quota exceeded 给出可执行建议","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"storage"},
  {"id":"SCN-CLEAR-001","capabilityIds":["CAP-DAT-16"],"branches":["H","F"],"auditOracle":"清除前预览并先处理待同步修改；失败时保留或明确确认丢弃，只清当前设备并产生新 identity","minimumLayers":["browser-db"],"baselineVerdict":"adequate","issueIds":[],"phase":"local-clearance"},
  {"id":"SCN-CLEAR-002","capabilityIds":["CAP-DAT-16"],"branches":["D","I"],"auditOracle":"预览后事实变化、准备任务运行或清除中断；stale preview 失效，不留下半清状态","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"local-clearance"},
  {"id":"SCN-DELETE-001","capabilityIds":["CAP-DAT-17"],"branches":["H","F","R"],"auditOracle":"fresh confirmation 后进入 deletion_pending/deleted；响应丢失/provider failure 可恢复且状态真实","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"account-deletion"},
  {"id":"SCN-DELETE-002","capabilityIds":["CAP-DAT-17"],"branches":["D","A"],"auditOracle":"pending 后旧 session/refresh credential/Replica/outbox 均无写资格，离线设备不能复活服务端数据","minimumLayers":["browser-db"],"baselineVerdict":"partial","issueIds":[],"phase":"account-deletion"},
  {"id":"SCN-DELETE-003","capabilityIds":["CAP-DAT-22"],"branches":["H","N"],"auditOracle":"删除前说明账号绑定备份以后无法凭该账号恢复，并提示处理离线设备和导出文件","minimumLayers":["browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"account-deletion"},
  {"id":"SCN-SUPPORT-001","capabilityIds":["CAP-DAT-19"],"branches":["H","N"],"auditOracle":"用户下载可审阅诊断；不含 token、内容、URL、stack、account，schema 版本明确","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"support"},
  {"id":"SCN-SUPPORT-002","capabilityIds":["CAP-XFN-13"],"branches":["F","R"],"auditOracle":"可见错误显示用户能提供的 request ID、诊断入口与安全下一步；跨 API/UI 保持关联","minimumLayers":["browser-db"],"baselineVerdict":"blocked:ISSUE-021","issueIds":["ISSUE-021"],"phase":"support"},
  {"id":"SCN-PRIVACY-001","capabilityIds":["CAP-XFN-12"],"branches":["N"],"auditOracle":"产品披露与实际 reliability/performance telemetry 字段一致，不发送 learner 内容、URL、stack、account","minimumLayers":["contract","integration","browser"],"baselineVerdict":"blocked:ISSUE-020","issueIds":["ISSUE-020"],"phase":"privacy"},
  {"id":"SCN-STATE-001","capabilityIds":["CAP-XFN-01"],"branches":["N"],"auditOracle":"所有关键入口在未保存、未 ready、未 applied、未 completion、未 synced 时不显示成功","minimumLayers":["integration","browser"],"baselineVerdict":"false-scope","issueIds":[],"phase":"state-truth"},
  {"id":"SCN-LIFECYCLE-001","capabilityIds":["CAP-SHL-09"],"branches":["I","R","D"],"auditOracle":"离开 screen 卸载 effect，返回只恢复合法 focus/scroll/parent；跨 tab 不静默覆盖 owner state","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"lifecycle"},
  {"id":"SCN-OFFLINE-001","capabilityIds":["CAP-XFN-02"],"branches":["H","R"],"auditOracle":"已访问应用在真实 Chromium 断网后打开合法深链并使用本机库；恢复联网后状态不丢","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"offline"},
  {"id":"SCN-UPDATE-001","capabilityIds":["CAP-XFN-03"],"branches":["H","I"],"auditOracle":"新 Service Worker ready 时不打断当前操作；只有用户确认后激活/reload","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"app-update"},
  {"id":"SCN-RESP-001","capabilityIds":["CAP-XFN-04"],"branches":["N"],"auditOracle":"主旅程在 320px、桌面、zoom、软键盘下无横向丢失或不可达操作","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"responsive"},
  {"id":"SCN-RESP-002","capabilityIds":["CAP-XFN-05"],"branches":["N","A"],"auditOracle":"standalone coarse pointer 的非空 stack 边缘手势可取消/提交且不抢活动 Runtime","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"responsive"},
  {"id":"SCN-A11Y-001","capabilityIds":["CAP-XFN-06"],"branches":["N"],"auditOracle":"主操作键盘可达；overlay 焦点恢复；控件有名称；说明/错误关联；异步状态被播报","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"accessibility"},
  {"id":"SCN-A11Y-002","capabilityIds":["CAP-XFN-07"],"branches":["N"],"auditOracle":"状态不只靠颜色、token 达 AA、reduced motion 不改变状态或遗漏反馈","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"accessibility"},
  {"id":"SCN-LANG-001","capabilityIds":["CAP-XFN-08"],"branches":["N"],"auditOracle":"UI、target、support、source content 各自使用准确 `lang`/direction，不以界面语言替代内容语言","minimumLayers":["browser"],"baselineVerdict":"partial","issueIds":[],"phase":"language-identity"},
  {"id":"SCN-PERF-001","capabilityIds":["CAP-XFN-09"],"branches":["N"],"auditOracle":"构建预算通过、重模块不回流、App Shell 不被云恢复阻塞；结论不冒充真实 CWV","minimumLayers":["artifact","browser"],"baselineVerdict":"adequate","issueIds":[],"phase":"performance"},
  {"id":"SCN-IDLE-001","capabilityIds":["CAP-XFN-10"],"branches":["N","D"],"auditOracle":"无 pending/过期任务时不轮询整库、Intake 或 Provider；有工作时按规定触发","minimumLayers":["integration","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"idle-work"},
  {"id":"SCN-SEC-001","capabilityIds":["CAP-XFN-11"],"branches":["N","A"],"auditOracle":"key 不回显到页面；origin 精确授权；私有 API 不进入 Service Worker 缓存","minimumLayers":["contract","artifact","browser"],"baselineVerdict":"partial","issueIds":[],"phase":"security"},
  {"id":"SCN-RELEASE-001","capabilityIds":["CAP-XFN-14"],"branches":["N"],"auditOracle":"真实邮箱、Auth redirect/refresh、商店扩展、Provider、支持邮箱分别留下可审计证据","minimumLayers":["external"],"baselineVerdict":"none","issueIds":[],"phase":"external-release-gate"},
  {"id":"SCN-RELEASE-002","capabilityIds":["CAP-XFN-15"],"branches":["N"],"auditOracle":"iOS/Android PWA 的安全区、软键盘、触感和边缘返回在真机验收","minimumLayers":["external"],"baselineVerdict":"none","issueIds":[],"phase":"external-release-gate"},
  {"id":"SCN-RELEASE-003","capabilityIds":["REL-REG-01"],"branches":["N"],"auditOracle":"内容发布后从生产 `/sensa/packages` 读取精确 Registry revision，并证明对应 Book 可发现","minimumLayers":["artifact","external"],"baselineVerdict":"blocked:ISSUE-028","issueIds":["ISSUE-028"],"phase":"external-release-gate"},
];
