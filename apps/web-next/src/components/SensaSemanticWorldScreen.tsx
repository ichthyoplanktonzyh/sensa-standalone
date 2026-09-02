import { useMemo, useState } from 'react';
import type { SemanticWorldScreenProps } from './SemanticWorldScreen';
import { PersonalMeaningComposer } from './PersonalMeaningComposer';
import {
  useJourneyGateway,
  useJourneyWorld,
  type JourneyAlignmentView,
  type JourneyFocusView,
  type JourneyProposalView,
  type JourneyWorldItemView,
  type SenseFormationPhase,
  type ExpressionBindingPhase,
} from '../personalMeaningJourney';
import type {
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';

type MeaningPhase = SenseFormationPhase;
type BindingPhase = ExpressionBindingPhase;
type FocusState = 'clarifying' | 'proposal' | 'accepted';
type WorldView = 'graph' | 'expanded' | 'list';
type WorldFilter = 'all' | 'continue' | 'binding' | 'complete';
type WorldSection = 'home' | 'meanings' | 'expressions';
type GraphNodeKind = 'meaning' | 'focus' | 'proposal' | 'sense' | 'expression';
type GraphEdgeRelation = 'focus' | 'proposal' | 'alignment' | 'binding';

interface ProposalBranch {
  senseProposalId: string;
  version: number;
  core: string;
  scenes: readonly string[];
  boundary: readonly string[];
  candidates: readonly string[];
}

interface AlignmentBranch {
  sense: string;
  senseVersionId: string;
  senseVersionNumber: number | null;
  senseVersionLabel: string;
  bindings: JourneyAlignmentView['confirmedBindings'];
}

interface FocusWorldView {
  id: string;
  label: string;
  detail: string;
  phase: JourneyFocusView['phase'];
  state: FocusState;
  proposal: ProposalBranch | null;
  alignment: AlignmentBranch | null;
}

interface WorldMeaningView {
  id: string;
  number: string;
  senseFormation: JourneyWorldItemView['senseFormation'];
  expressionBinding: JourneyWorldItemView['expressionBinding'];
  anchorLabel: string;
  anchor: string;
  familiarExpressions: JourneyWorldItemView['familiarAnchors'];
  experienceAnchors: JourneyWorldItemView['experienceAnchors'];
  focuses: readonly FocusWorldView[];
  note: string;
}

interface BoundExpressionView {
  id: string;
  personalMeaningId: string;
  meaningFocusId: string;
  surfaceForm: string;
  expressionType: SensaExpressionType;
  languageTag: string;
  relation: SensaExpressionBindingRelation;
  semanticCoverage: SensaSemanticCoverage;
  sense: string;
  source: string;
}

interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  subtitle: string;
  detail: string;
  state: MeaningPhase | BindingPhase | FocusState | 'confirmed';
  personalMeaningId: string;
  meaningFocusId?: string;
  opensConfirmedSense?: boolean;
  actionLabel: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: GraphEdgeRelation;
  label: string;
}

interface GraphPosition {
  x: number;
  y: number;
}

const senseFormationLabels: Record<MeaningPhase, string> = {
  focus_missing: '尚未形成 Focus',
  focus_pending_acceptance: 'Focus 待确认',
  clarifying: '澄清中',
  proposal_pending: 'Proposal 待确认',
  sense_confirmed: 'Sense 已确认',
};

const expressionBindingLabels: Record<BindingPhase, string> = {
  not_ready: '尚不可开始',
  pending: '待绑定',
  partial: '部分已绑定',
  bound: '已绑定',
};

const expressionTypeLabels: Record<SensaExpressionType, string> = {
  word: '单词',
  phrase: '短语',
  construction: '构式',
  sentence: '完整句子',
  utterance_strategy: '表达方式',
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  realizes: '实现',
  approximates: '近似',
  evokes: '唤起',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '完全覆盖',
  broader: '范围更宽',
  narrower: '范围更窄',
  overlapping: '部分重叠',
};

const languageLabels: Record<string, string> = {
  en: '英语',
  'zh-CN': '中文（简体）',
};

const expressionTypeLabel = (value: SensaExpressionType): string => expressionTypeLabels[value];
const relationLabel = (value: SensaExpressionBindingRelation): string => relationLabels[value];
const coverageLabel = (value: SensaSemanticCoverage): string => coverageLabels[value];
const languageLabel = (value: string): string => languageLabels[value] ?? `语言 ${value}`;

const graphNodeKindLabels: Record<GraphNodeKind, string> = {
  meaning: 'Personal Meaning',
  focus: 'Meaning Focus',
  proposal: 'Sense Proposal',
  sense: '已确认 Sense',
  expression: 'Expression Binding',
};

const meaningNodeId = (meaningId: string) => `meaning:${meaningId}`;
const focusNodeId = (meaningId: string, focusId: string) => `focus:${meaningId}:${focusId}`;
const proposalNodeId = (meaningId: string, focusId: string, proposalId: string) =>
  `proposal:${meaningId}:${focusId}:${proposalId}`;
const senseNodeId = (meaningId: string, focusId: string, senseVersionId: string) =>
  `sense:${meaningId}:${focusId}:${senseVersionId}`;
const expressionNodeId = (
  meaningId: string,
  focusId: string,
  bindingVersionId: string,
) => `expression:${meaningId}:${focusId}:${bindingVersionId}`;

const formatAnchorLabel = (item: JourneyWorldItemView): string =>
  item.detail.experienceAnchors.length > 0 ? '我的具体经验' : '我的熟悉表达';

const proposalViewFor = (proposal: JourneyProposalView | null): ProposalBranch | null => {
  if (!proposal || proposal.status !== 'open') return null;
  const scenes = proposal.prototypeScenes.map((scene) => scene.summary).filter(Boolean);
  const boundary = [
    proposal.includedCases.length > 0
      ? `包含：${proposal.includedCases.join('；')}`
      : '',
    proposal.excludedCases.length > 0
      ? `不包含：${proposal.excludedCases.join('；')}`
      : '',
  ].filter(Boolean);
  return {
    senseProposalId: proposal.senseProposalId,
    version: proposal.version,
    core: proposal.coreMeaningFocus,
    scenes,
    boundary,
    candidates: proposal.expressionCandidates.map(
      (candidate) => `${candidate.surfaceForm} · ${expressionTypeLabel(candidate.expressionType)}`,
    ),
  };
};

const alignmentViewFor = (alignment: JourneyAlignmentView | null): AlignmentBranch | null => {
  if (!alignment) return null;
  return {
    sense: alignment.coreMeaningFocus || alignment.senseShortId,
    senseVersionId: alignment.senseVersionId,
    senseVersionNumber: alignment.senseVersionNumber,
    senseVersionLabel: alignment.senseVersionNumber === null
      ? `Sense identity · ${alignment.senseVersionId}`
      : `Sense Version · v${alignment.senseVersionNumber}`,
    bindings: alignment.confirmedBindings,
  };
};

const focusStateFor = (focus: JourneyFocusView): FocusState => {
  if (focus.alignment) return 'accepted';
  if (focus.proposal?.status === 'open') return 'proposal';
  return focus.accepted ? 'accepted' : 'clarifying';
};

const focusDetailFor = (focus: JourneyFocusView): string =>
  focus.distinguishingNotes.length > 0
    ? focus.distinguishingNotes.join('；')
    : focus.statement;

const worldMeaningFor = (item: JourneyWorldItemView, index: number): WorldMeaningView => {
  const detail = item.detail;
  const firstExperience = detail.experienceAnchors[0]?.surfaceForm;
  const firstFamiliar = detail.familiarAnchors[0]?.surfaceForm;
  const anchor = firstExperience || firstFamiliar || item.primaryLabel;
  const focuses = detail.focuses.map((focus) => ({
    id: focus.meaningFocusId,
    label: focus.statement,
    detail: focusDetailFor(focus),
    phase: focus.phase,
    state: focusStateFor(focus),
    proposal: proposalViewFor(focus.proposal),
    alignment: alignmentViewFor(focus.alignment),
  }));

  return {
    id: item.personalMeaningId,
    number: String(index + 1).padStart(2, '0'),
    senseFormation: item.senseFormation,
    expressionBinding: item.expressionBinding,
    anchorLabel: formatAnchorLabel(item),
    anchor,
    familiarExpressions: detail.familiarAnchors,
    experienceAnchors: detail.experienceAnchors,
    focuses,
    note: detail.focuses.length === 0
      ? '这条 Personal Meaning 还没有可展开的 Meaning Focus 事实。'
      : 'Personal Meaning 保留你的个人锚点；Sense 与 Expression 只在相应连接事实确认后出现。',
  };
};

const expressionsFor = (meanings: readonly WorldMeaningView[]): BoundExpressionView[] =>
  meanings.flatMap((meaning) => meaning.focuses.flatMap((focus) => {
    if (!focus.alignment) return [];
    return focus.alignment.bindings.map((binding) => ({
      id: binding.bindingVersionId,
      personalMeaningId: meaning.id,
      meaningFocusId: focus.id,
      surfaceForm: binding.surfaceForm,
      expressionType: binding.expressionType,
      languageTag: binding.languageTag,
      relation: binding.relation,
      semanticCoverage: binding.semanticCoverage,
      sense: focus.alignment!.sense,
      source: meaning.anchor,
    }));
  }));

const searchableValuesFor = (meaning: WorldMeaningView): string[] => [
  meaning.anchor,
  ...meaning.familiarExpressions.map((anchor) => anchor.surfaceForm),
  ...meaning.experienceAnchors.map((anchor) => anchor.surfaceForm),
  ...meaning.focuses.flatMap((focus) => [
    focus.label,
    focus.detail,
    focus.proposal?.core,
    ...(focus.proposal?.scenes ?? []),
    ...(focus.proposal?.boundary ?? []),
    ...(focus.proposal?.candidates ?? []),
    focus.alignment?.sense,
    focus.alignment?.senseVersionLabel,
    ...(focus.alignment?.bindings.flatMap((binding) => [
      binding.surfaceForm,
      binding.expressionType,
      binding.languageTag,
      binding.relation,
      binding.semanticCoverage,
    ]) ?? []),
  ]),
  meaning.note,
].filter((value): value is string => Boolean(value));

const meaningMatchesQuery = (meaning: WorldMeaningView, query: string): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return searchableValuesFor(meaning)
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalizedQuery);
};

interface MeaningPrimaryAction {
  label: string;
  meaningFocusId?: string;
  opensConfirmedSense: boolean;
}

const meaningPrimaryAction = (meaning: WorldMeaningView): MeaningPrimaryAction => {
  if (meaning.senseFormation.phase === 'focus_missing') {
    return { label: '开始形成 Focus', opensConfirmedSense: false };
  }
  if (meaning.senseFormation.phase === 'focus_pending_acceptance') {
    return {
      label: '确认这个侧面',
      meaningFocusId: meaning.senseFormation.nextFocusId ?? undefined,
      opensConfirmedSense: false,
    };
  }
  if (meaning.senseFormation.phase === 'clarifying') {
    const next = meaning.focuses.find((focus) => focus.id === meaning.senseFormation.nextFocusId);
    return {
      label: next?.phase === 'focus_accepted' ? '让模型理解' : '继续和模型澄清',
      meaningFocusId: meaning.senseFormation.nextFocusId ?? undefined,
      opensConfirmedSense: false,
    };
  }
  if (meaning.senseFormation.phase === 'proposal_pending') {
    return {
      label: '确认这个意思',
      meaningFocusId: meaning.senseFormation.nextFocusId ?? undefined,
      opensConfirmedSense: false,
    };
  }

  const pendingBindingFocusId = meaning.expressionBinding.nextFocusId;
  const confirmedFocusId = pendingBindingFocusId
    ?? meaning.focuses.find((focus) => focus.alignment)?.id;
  return {
    label: pendingBindingFocusId
      ? '绑定目标表达'
      : meaning.expressionBinding.phase === 'bound'
        ? '查看表达连接'
        : '查看已确认的意思',
    meaningFocusId: confirmedFocusId,
    opensConfirmedSense: true,
  };
};

const focusActionLabel = (focus: FocusWorldView): string => {
  if (focus.alignment) return '查看已确认的意思';
  if (focus.phase === 'proposal_ready') return '确认这个意思';
  if (focus.phase === 'constructing') return '继续和模型澄清';
  if (focus.phase === 'focus_accepted') return '让模型理解';
  return '确认这个侧面';
};

const senseFormationIcon = (phase: MeaningPhase) => {
  if (phase === 'sense_confirmed') return '✓';
  if (phase === 'proposal_pending' || phase === 'clarifying') return '…';
  return '○';
};

const bindingIcon = (phase: BindingPhase) => {
  if (phase === 'bound') return '✓';
  if (phase === 'partial' || phase === 'pending') return '…';
  return '·';
};

const StatusMark = ({ phase }: { phase: MeaningPhase }) => (
  <span className={`personal-world-v2__status-mark is-${phase}`} aria-hidden="true">
    {senseFormationIcon(phase)}
  </span>
);

const BindingStatusMark = ({ phase }: { phase: BindingPhase }) => (
  <span className={`personal-world-v2__status-mark is-binding-${phase}`} aria-hidden="true">
    {bindingIcon(phase)}
  </span>
);

const StatusAxes = ({ meaning }: { meaning: WorldMeaningView }) => (
  <div className="personal-world-v2__status-axes" aria-label="个人意义的两个独立状态">
    <span className={`personal-world-v2__axis is-sense-${meaning.senseFormation.phase}`}>
      <small>意义形成</small>
      <b><StatusMark phase={meaning.senseFormation.phase} />{senseFormationLabels[meaning.senseFormation.phase]}</b>
      <em>{meaning.senseFormation.confirmedSenseCount}/{meaning.senseFormation.focusCount} 个 Focus 已有 Sense</em>
    </span>
    <span className={`personal-world-v2__axis is-binding-${meaning.expressionBinding.phase}`}>
      <small>表达连接</small>
      <b><BindingStatusMark phase={meaning.expressionBinding.phase} />{expressionBindingLabels[meaning.expressionBinding.phase]}</b>
      <em>{meaning.expressionBinding.confirmedBindingCount} 条已确认表达</em>
    </span>
  </div>
);

const CompactStatus = ({ meaning }: { meaning: WorldMeaningView }) => (
  <div className="personal-world-v2__compact-status" aria-label="当前进度">
    <span className={`is-sense-${meaning.senseFormation.phase}`}>
      <StatusMark phase={meaning.senseFormation.phase} />
      {senseFormationLabels[meaning.senseFormation.phase]}
    </span>
    {meaning.expressionBinding.phase !== 'not_ready' && (
      <span className={`is-binding-${meaning.expressionBinding.phase}`}>
        <BindingStatusMark phase={meaning.expressionBinding.phase} />
        {expressionBindingLabels[meaning.expressionBinding.phase]}
      </span>
    )}
  </div>
);

const AnchorChips = ({ meaning }: { meaning: WorldMeaningView }) => (
  <div className="personal-world-v2__anchors" aria-label="Personal Meaning 的个人锚点">
    {meaning.experienceAnchors.map((anchor) => (
      <span className="personal-world-v2__anchor-chip is-experience" key={anchor.anchorId}>
        我的场景 · {anchor.surfaceForm}
      </span>
    ))}
    {meaning.familiarExpressions.map((anchor) => (
      <span className="personal-world-v2__anchor-chip is-expression" key={anchor.anchorId}>
        熟悉表达 · {anchor.surfaceForm}
      </span>
    ))}
  </div>
);

const ProposalBranch = ({ proposal }: { proposal: ProposalBranch }) => (
  <div className="personal-world-v2__proposal" aria-label="待确认的 Sense Proposal">
    <header className="personal-world-v2__branch-header">
      <span className="personal-world-v2__branch-symbol is-proposal" aria-hidden="true">?</span>
      <span>
        <small>Sense Proposal · v{proposal.version}</small>
        <b>模型给出的可复现意义规格</b>
      </span>
      <em>待确认</em>
    </header>

    {proposal.core && <p className="personal-world-v2__proposal-core">{proposal.core}</p>}

    {proposal.candidates.length > 0 && (
      <div className="personal-world-v2__candidate-row">
        <small>目标语言表达候选</small>
        <div>
          {proposal.candidates.map((candidate) => <span key={candidate}>{candidate}</span>)}
        </div>
      </div>
    )}
  </div>
);

const AlignmentBranch = ({ alignment }: { alignment: AlignmentBranch }) => (
  <div className="personal-world-v2__alignment" aria-label="已确认的意思连接">
    <header className="personal-world-v2__branch-header">
      <span className="personal-world-v2__branch-symbol is-alignment" aria-hidden="true">✓</span>
      <span>
        <small>Personal Meaning Alignment</small>
        <b>已确认的意思连接</b>
      </span>
      <em>已确认</em>
    </header>

    <div className="personal-world-v2__sense-block">
      <span className="personal-world-v2__micro-label">Sense · 公共意义身份</span>
      <strong>{alignment.sense}</strong>
      <small>{alignment.senseVersionLabel}</small>
    </div>

    {alignment.bindings.length > 0 ? (
      <div className="personal-world-v2__binding-list">
        {alignment.bindings.map((binding) => (
          <div className="personal-world-v2__binding" key={binding.bindingVersionId}>
            <span className="personal-world-v2__micro-label">Expression Binding · 表达绑定</span>
            <div className="personal-world-v2__binding-line">
              <strong>{binding.surfaceForm}</strong>
              <span>{expressionTypeLabel(binding.expressionType)} · {languageLabel(binding.languageTag)}</span>
            </div>
            <small>{relationLabel(binding.relation)} · {coverageLabel(binding.semanticCoverage)}</small>
          </div>
        ))}
      </div>
    ) : (
      <div className="personal-world-v2__focus-next">
        <span className="personal-world-v2__next-dash" aria-hidden="true" />
        <span><b>Expression Binding 尚未确认</b><small>Sense 已确认，但表达连接仍是独立动作</small></span>
      </div>
    )}

  </div>
);

const FocusBranch = ({ focus }: { focus: FocusWorldView }) => (
  <article className={`personal-world-v2__focus is-${focus.state}`}>
    <header className="personal-world-v2__focus-header">
      <span className="personal-world-v2__focus-marker" aria-hidden="true" />
      <span>
        <small>Meaning Focus</small>
        <b>我真正在意的是</b>
      </span>
      <em>
        {focus.alignment
          ? focus.alignment.bindings.length > 0 ? '已确认连接' : 'Sense 已确认'
          : focus.proposal ? 'Proposal 待确认' : focus.state === 'accepted' ? '已接受 Focus' : '继续澄清'}
      </em>
    </header>
    <h4>{focus.label}</h4>
    <p>{focus.detail}</p>
    {focus.proposal && <ProposalBranch proposal={focus.proposal} />}
    {focus.alignment && <AlignmentBranch alignment={focus.alignment} />}
    {!focus.proposal && !focus.alignment && (
      <div className="personal-world-v2__focus-next">
        <span className="personal-world-v2__next-dash" aria-hidden="true" />
        <span>
          <b>{focus.state === 'clarifying' ? '当前 Focus 尚未接受' : '还没有可确认的公共 Sense'}</b>
          <small>{focus.state === 'clarifying' ? '接受当前 Focus 后才能开始 Sense Construction' : '可以继续补充这个方向的场景与边界'}</small>
        </span>
      </div>
    )}
  </article>
);

const MeaningConstellation = ({
  meaning,
  onOpen,
  onOpenConfirmedSense,
}: {
  meaning: WorldMeaningView;
  onOpen: (meaningFocusId?: string) => void;
  onOpenConfirmedSense: (meaningFocusId: string) => void;
}) => {
  const primaryAction = meaningPrimaryAction(meaning);
  return (
  <article className={`personal-world-v2__meaning-card is-${meaning.senseFormation.phase}`}>
    <header className="personal-world-v2__meaning-header">
      <div className="personal-world-v2__meaning-number">{meaning.number}</div>
      <div className="personal-world-v2__meaning-title">
        <span>Personal Meaning · 我的意思</span>
        <h3>{meaning.anchor}</h3>
      </div>
      <StatusAxes meaning={meaning} />
    </header>

    <div className="personal-world-v2__anchor-ground">
      <small>{meaning.anchorLabel}</small>
      <p>{meaning.anchor}</p>
      <AnchorChips meaning={meaning} />
    </div>

    {meaning.focuses.length > 0 ? (
      <div className="personal-world-v2__focuses" aria-label="Meaning Focus 关系">
        {meaning.focuses.map((focus) => (
          <div key={focus.id}>
            <FocusBranch focus={focus} />
            {focus.alignment && (
              <button
                type="button"
                className="personal-world-v2__focus-open-sense"
                onClick={() => onOpenConfirmedSense(focus.id)}
              >
                查看已确认 Sense <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="personal-world-v2__unclarified">
        <span className="personal-world-v2__unclarified-orbit" aria-hidden="true"><i /><i /><i /></span>
        <span><b>这里还没有 Meaning Focus 事实</b><small>下一步可以从这段经验中说出：我真正想保留的是什么？</small></span>
      </div>
    )}

    <button
      type="button"
      className="personal-world-v2__meaning-open"
      onClick={() => {
        if (primaryAction.opensConfirmedSense && primaryAction.meaningFocusId) {
          onOpenConfirmedSense(primaryAction.meaningFocusId);
          return;
        }
        onOpen(primaryAction.meaningFocusId);
      }}
    >
      {primaryAction.label}
      <span aria-hidden="true">→</span>
    </button>
  </article>
  );
};

const GRAPH_CANVAS_WIDTH = 980;
const GRAPH_COLUMN_X: Record<'meaning' | 'focus' | 'semantic' | 'expression', number> = {
  meaning: 112,
  focus: 354,
  semantic: 600,
  expression: 842,
};
const GRAPH_START_Y = 86;
const GRAPH_ROW_GAP = 126;
const GRAPH_BAND_GAP = 72;

interface GraphBandRow {
  focusNodeId: string | null;
  semanticNodeIds: string[];
  expressionNodeIds: string[];
}

interface GraphBand {
  meaningNodeId: string;
  rows: GraphBandRow[];
}

const buildGraph = (meanings: readonly WorldMeaningView[]) => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const bands: GraphBand[] = [];

  meanings.forEach((meaning) => {
    const primaryAction = meaningPrimaryAction(meaning);
    const band: GraphBand = {
      meaningNodeId: meaningNodeId(meaning.id),
      rows: [],
    };
    nodes.push({
      id: meaningNodeId(meaning.id),
      kind: 'meaning',
      label: meaning.anchor,
      subtitle: `${graphNodeKindLabels.meaning} · ${senseFormationLabels[meaning.senseFormation.phase]}`,
      detail: [
        `意义形成：${senseFormationLabels[meaning.senseFormation.phase]}`,
        `表达连接：${expressionBindingLabels[meaning.expressionBinding.phase]}`,
        ...meaning.experienceAnchors.map((anchor) => `我的场景：${anchor.surfaceForm}`),
        ...meaning.familiarExpressions.map((anchor) => `熟悉表达：${anchor.surfaceForm}`),
      ].join('；'),
      state: meaning.senseFormation.phase,
      personalMeaningId: meaning.id,
      meaningFocusId: primaryAction.meaningFocusId,
      opensConfirmedSense: primaryAction.opensConfirmedSense,
      actionLabel: primaryAction.label,
    });

    if (meaning.focuses.length === 0) {
      band.rows.push({ focusNodeId: null, semanticNodeIds: [], expressionNodeIds: [] });
    }

    meaning.focuses.forEach((focus) => {
      const focusId = focusNodeId(meaning.id, focus.id);
      const rowCount = Math.max(1, focus.alignment?.bindings.length ?? 0);
      const focusRows = Array.from({ length: rowCount }, () => ({
        focusNodeId: null as string | null,
        semanticNodeIds: [] as string[],
        expressionNodeIds: [] as string[],
      }));
      focusRows[0].focusNodeId = focusId;
      nodes.push({
        id: focusId,
        kind: 'focus',
        label: focus.label,
        subtitle: graphNodeKindLabels.focus,
        detail: focus.detail,
        state: focus.state,
        personalMeaningId: meaning.id,
        meaningFocusId: focus.id,
        opensConfirmedSense: Boolean(focus.alignment),
        actionLabel: focusActionLabel(focus),
      });
      edges.push({
        id: `${meaning.id}->${focus.id}`,
        from: meaningNodeId(meaning.id),
        to: focusId,
        relation: 'focus',
        label: '我的关注方向',
      });

      if (focus.proposal) {
        const proposalId = proposalNodeId(meaning.id, focus.id, focus.proposal.senseProposalId);
        focusRows[0].semanticNodeIds.push(proposalId);
        nodes.push({
          id: proposalId,
          kind: 'proposal',
          label: focus.proposal.core || `Proposal · v${focus.proposal.version}`,
          subtitle: `${graphNodeKindLabels.proposal} · v${focus.proposal.version}`,
          detail: [focus.proposal.core, ...focus.proposal.scenes, ...focus.proposal.boundary].filter(Boolean).join('；'),
          state: 'proposal',
          personalMeaningId: meaning.id,
          meaningFocusId: focus.id,
          actionLabel: '确认这个意思',
        });
        edges.push({
          id: `${focus.id}->proposal:${focus.proposal.senseProposalId}`,
          from: focusId,
          to: proposalId,
          relation: 'proposal',
          label: '模型建议',
        });
      }

      if (focus.alignment) {
        const senseId = senseNodeId(meaning.id, focus.id, focus.alignment.senseVersionId);
        focusRows[0].semanticNodeIds.push(senseId);
        nodes.push({
          id: senseId,
          kind: 'sense',
          label: focus.alignment.sense,
          subtitle: `${graphNodeKindLabels.sense} · ${focus.alignment.senseVersionLabel}`,
          detail: 'Personal Meaning Alignment 已确认',
          state: 'confirmed',
          personalMeaningId: meaning.id,
          meaningFocusId: focus.id,
          opensConfirmedSense: true,
          actionLabel: '查看已确认 Sense',
        });
        edges.push({
          id: `${focus.id}->sense:${focus.alignment.senseVersionId}`,
          from: focusId,
          to: senseId,
          relation: 'alignment',
          label: '已确认连接',
        });

        focus.alignment.bindings.forEach((binding, bindingIndex) => {
          const expressionId = expressionNodeId(meaning.id, focus.id, binding.bindingVersionId);
          const bindingRow = focusRows[bindingIndex];
          bindingRow.expressionNodeIds.push(expressionId);
          nodes.push({
            id: expressionId,
            kind: 'expression',
            label: binding.surfaceForm,
            subtitle: `${graphNodeKindLabels.expression} · ${expressionTypeLabel(binding.expressionType)}`,
            detail: `${languageLabel(binding.languageTag)} · ${relationLabel(binding.relation)} · ${coverageLabel(binding.semanticCoverage)}`,
            state: 'confirmed',
            personalMeaningId: meaning.id,
            meaningFocusId: focus.id,
            opensConfirmedSense: true,
            actionLabel: '查看已确认 Sense',
          });
          edges.push({
            id: `${binding.bindingVersionId}->expression`,
            from: senseId,
            to: expressionId,
            relation: 'binding',
            label: '表达绑定',
          });
        });
      }
      band.rows.push(...focusRows);
    });

    bands.push(band);
  });

  const positions = new Map<string, GraphPosition>();
  let cursorY = GRAPH_START_Y;
  let lastBandBottom = GRAPH_START_Y;
  bands.forEach((band) => {
    const rowCount = band.rows.length;
    const bandBottom = cursorY + (rowCount - 1) * GRAPH_ROW_GAP;
    positions.set(band.meaningNodeId, {
      x: GRAPH_COLUMN_X.meaning,
      y: cursorY + (bandBottom - cursorY) / 2,
    });
    band.rows.forEach((row, index) => {
      const y = cursorY + index * GRAPH_ROW_GAP;
      if (row.focusNodeId) {
        positions.set(row.focusNodeId, { x: GRAPH_COLUMN_X.focus, y });
      }
      row.semanticNodeIds.forEach((nodeId) => {
        positions.set(nodeId, { x: GRAPH_COLUMN_X.semantic, y });
      });
      row.expressionNodeIds.forEach((nodeId) => {
        positions.set(nodeId, { x: GRAPH_COLUMN_X.expression, y });
      });
    });
    lastBandBottom = bandBottom;
    cursorY = bandBottom + GRAPH_ROW_GAP + GRAPH_BAND_GAP;
  });

  return {
    nodes,
    edges,
    positions,
    canvasHeight: Math.max(300, lastBandBottom + 92),
  };
};

const EmptyWorldState = ({
  mode,
  onCreate,
}: {
  mode: 'world' | 'filtered';
  onCreate: () => void;
}) => (
  <div className="personal-world-v2__empty" role="status">
    <span className="personal-world-v2__empty-mark" aria-hidden="true">⌕</span>
    <b>{mode === 'world' ? '还没有保存的 Personal Meaning' : '没有匹配当前搜索或筛选的项目'}</b>
    <p>
      {mode === 'world'
        ? '从一段具体经验或熟悉表达开始，创建你的第一条个人意义。'
        : '你的其他 Personal Meaning 仍然保留；可以清除搜索或更换状态筛选。'}
    </p>
    {mode === 'world' && (
      <button type="button" className="personal-world-v2__empty-action" onClick={onCreate}>
        创建个人意义
      </button>
    )}
  </div>
);

const WorldErrorState = ({
  error,
  onReload,
}: {
  error: string | null;
  onReload: () => void;
}) => (
  <div className="personal-world-v2__empty" role="alert">
    <span className="personal-world-v2__empty-mark" aria-hidden="true">!</span>
    <b>个人意义世界暂时无法读取</b>
    <p>{error || '本机个人意义数据不可用。'}</p>
    <button type="button" className="personal-world-v2__empty-action" onClick={onReload}>
      重新读取
    </button>
  </div>
);

const GraphView = ({
  meanings,
  emptyMode,
  onCreate,
  onOpen,
  onOpenConfirmedSense,
}: {
  meanings: readonly WorldMeaningView[];
  emptyMode: 'world' | 'filtered';
  onCreate: () => void;
  onOpen: (personalMeaningId: string, meaningFocusId?: string) => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
}) => {
  const graph = useMemo(() => buildGraph(meanings), [meanings]);
  const [zoom, setZoom] = useState(0.75);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const connectedNodeIds = new Set<string>();

  if (selectedNode) {
    connectedNodeIds.add(selectedNode.id);
    graph.edges.forEach((edge) => {
      if (edge.from === selectedNode.id) connectedNodeIds.add(edge.to);
      if (edge.to === selectedNode.id) connectedNodeIds.add(edge.from);
    });
  }

  if (meanings.length === 0) {
    return (
      <div className="personal-world-v2__graph-view" aria-label="Personal Meaning 图谱视图">
        <div className="personal-world-v2__world-caption">
          <span className="personal-world-v2__caption-line" aria-hidden="true" />
          <p>图谱只从明确记录的 Personal Meaning、Focus 和连接关系生成。</p>
        </div>
        <EmptyWorldState mode={emptyMode} onCreate={onCreate} />
      </div>
    );
  }

  return (
    <div className="personal-world-v2__graph-view" aria-label="Personal Meaning 图谱视图">
      <div className="personal-world-v2__world-caption">
        <span className="personal-world-v2__caption-line" aria-hidden="true" />
        <p>图谱只展开真实关系；节点位置是本页的阅读布局，不表示语义距离或脑内结构。</p>
      </div>

      <div className="personal-world-v2__graph-toolbar">
        <span><b>关系图谱</b><small>{graph.nodes.length} 个节点 · {graph.edges.length} 条明确关系</small></span>
        <div className="personal-world-v2__graph-zoom" role="group" aria-label="图谱缩放">
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(.75, current - .25))}
            aria-label="缩小图谱"
            disabled={zoom <= .75}
          >−</button>
          <output className="personal-world-v2__graph-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(1.25, current + .25))}
            aria-label="放大图谱"
            disabled={zoom >= 1.25}
          >＋</button>
        </div>
      </div>

      <div className="personal-world-v2__graph-viewport" tabIndex={0} aria-label="可横向和纵向滚动的关系图谱画布">
        <div
          className="personal-world-v2__graph-stage"
          style={{ width: `${GRAPH_CANVAS_WIDTH * zoom}px`, height: `${graph.canvasHeight * zoom}px` }}
        >
          <div
            className="personal-world-v2__graph-canvas"
            style={{ width: `${GRAPH_CANVAS_WIDTH}px`, height: `${graph.canvasHeight}px`, transform: `scale(${zoom})` }}
          >
            <div className="personal-world-v2__graph-column-labels" aria-hidden="true">
              <span>我的意思</span><span>我真正在意的方向</span><span>模型建议 / 已确认 Sense</span><span>表达形式</span>
            </div>
            <svg className="personal-world-v2__graph-edges" viewBox={`0 0 ${GRAPH_CANVAS_WIDTH} ${graph.canvasHeight}`} aria-hidden="true">
              <defs>
                <marker id="personal-world-v2-arrow-focus" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="#9e875e" /></marker>
                <marker id="personal-world-v2-arrow-proposal" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="#b28d4e" /></marker>
                <marker id="personal-world-v2-arrow-alignment" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="#3e7b63" /></marker>
                <marker id="personal-world-v2-arrow-binding" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="#5f746a" /></marker>
              </defs>
              {graph.edges.map((edge) => {
                const from = graph.positions.get(edge.from)!;
                const to = graph.positions.get(edge.to)!;
                const edgeIsActive = !selectedNode || edge.from === selectedNode.id || edge.to === selectedNode.id;
                const labelX = (from.x + to.x) / 2;
                const labelY = (from.y + to.y) / 2 - 7;
                return (
                  <g key={edge.id} className={`personal-world-v2__graph-edge is-${edge.relation}${edgeIsActive ? '' : ' is-dimmed'}`}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd={`url(#personal-world-v2-arrow-${edge.relation})`} />
                    <text x={labelX} y={labelY}>{edge.label}</text>
                  </g>
                );
              })}
            </svg>
            <div className="personal-world-v2__graph-nodes">
              {graph.nodes.map((node) => {
                const position = graph.positions.get(node.id)!;
                const isSelected = selectedNode?.id === node.id;
                const isDimmed = Boolean(selectedNode) && !connectedNodeIds.has(node.id);
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`personal-world-v2__graph-node is-${node.kind}${isSelected ? ' is-selected' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                    style={{ left: `${position.x}px`, top: `${position.y}px` }}
                    aria-label={`${graphNodeKindLabels[node.kind]}：${node.label}。${node.subtitle}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedNodeId((current) => (current === node.id ? null : node.id))}
                  >
                    <span className="personal-world-v2__graph-node-kind">{node.subtitle}</span>
                    <strong>{node.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="personal-world-v2__graph-key" aria-label="图谱关系图例">
        <span className="is-meaning">个人意义</span>
        <span className="is-focus">Focus</span>
        <span className="is-proposal">模型建议</span>
        <span className="is-confirmed">已确认连接</span>
        <span className="is-expression">表达绑定</span>
      </div>

      <div className="personal-world-v2__graph-selection" aria-live="polite">
        {selectedNode ? (
          <>
            <span>当前选中 · {graphNodeKindLabels[selectedNode.kind]}</span>
            <strong>{selectedNode.label}</strong>
            <p>{selectedNode.detail}</p>
            <button
              type="button"
              className="personal-world-v2__graph-inspector-action"
              onClick={() => {
                if (selectedNode.meaningFocusId && selectedNode.opensConfirmedSense) {
                  onOpenConfirmedSense(selectedNode.personalMeaningId, selectedNode.meaningFocusId);
                  return;
                }
                onOpen(selectedNode.personalMeaningId, selectedNode.meaningFocusId);
              }}
            >
              {selectedNode.actionLabel} <span aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <>
            <span>查看关系事实</span>
            <strong>选择一个节点</strong>
            <p>选中后会突出它与一跳真实邻居，其他节点暂时退到背景。</p>
          </>
        )}
      </div>
    </div>
  );
};

const ExpandedView = ({
  meanings,
  emptyMode,
  onCreate,
  onOpen,
  onOpenConfirmedSense,
}: {
  meanings: readonly WorldMeaningView[];
  emptyMode: 'world' | 'filtered';
  onCreate: () => void;
  onOpen: (personalMeaningId: string, meaningFocusId?: string) => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
}) => (
  <div className="personal-world-v2__expanded-view" aria-label="Personal Meaning 展开视图">
    <div className="personal-world-v2__constellations">
      {meanings.length > 0
        ? meanings.map((meaning) => (
          <MeaningConstellation
            key={meaning.id}
            meaning={meaning}
            onOpen={(meaningFocusId) => onOpen(meaning.id, meaningFocusId)}
            onOpenConfirmedSense={(meaningFocusId) => onOpenConfirmedSense(meaning.id, meaningFocusId)}
          />
        ))
        : <EmptyWorldState mode={emptyMode} onCreate={onCreate} />}
    </div>
  </div>
);

const ListView = ({
  meanings,
  emptyMode,
  preferBinding,
  onCreate,
  onOpen,
  onOpenConfirmedSense,
}: {
  meanings: readonly WorldMeaningView[];
  emptyMode: 'world' | 'filtered';
  preferBinding: boolean;
  onCreate: () => void;
  onOpen: (personalMeaningId: string, meaningFocusId?: string) => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
}) => (
  <div className="personal-world-v2__list-view" aria-label="Personal Meaning 清单视图">
    <div className="personal-world-v2__list-card">
      {meanings.length === 0 ? <EmptyWorldState mode={emptyMode} onCreate={onCreate} /> : meanings.map((meaning) => {
        const primaryAction = preferBinding && meaning.expressionBinding.nextFocusId
          ? {
            label: '绑定目标表达',
            meaningFocusId: meaning.expressionBinding.nextFocusId,
            opensConfirmedSense: true,
          }
          : meaningPrimaryAction(meaning);
        const nextFocus = meaning.focuses.find((focus) => focus.id === primaryAction.meaningFocusId)
          ?? meaning.focuses[0];
        return (
        <article className="personal-world-v2__list-item" key={meaning.id}>
          <header>
            <div className="personal-world-v2__meaning-number">{meaning.number}</div>
            <div>
              <span>Personal Meaning · 我的意思</span>
              <h3>{meaning.anchor}</h3>
            </div>
            <CompactStatus meaning={meaning} />
          </header>

          <div className="personal-world-v2__list-next">
            <small>{nextFocus ? '当前方向' : '下一步'}</small>
            <strong>{nextFocus?.label ?? '从这段经验中切出一个 Meaning Focus'}</strong>
            {meaning.focuses.length > 1 && <span>另有 {meaning.focuses.length - 1} 个独立方向</span>}
          </div>
          <button
            type="button"
            className="personal-world-v2__meaning-open"
            onClick={() => {
              if (primaryAction.opensConfirmedSense && primaryAction.meaningFocusId) {
                onOpenConfirmedSense(meaning.id, primaryAction.meaningFocusId);
                return;
              }
              onOpen(meaning.id, primaryAction.meaningFocusId);
            }}
          >
            {primaryAction.label}
            <span aria-hidden="true">→</span>
          </button>
        </article>
        );
      })}
    </div>
  </div>
);

const ExpressionRows = ({
  expressions,
  compact = false,
  onOpen,
}: {
  expressions: readonly BoundExpressionView[];
  compact?: boolean;
  onOpen: (personalMeaningId: string, meaningFocusId: string) => void;
}) => (
  <div className={`personal-world-v2__expression-rows${compact ? ' is-compact' : ''}`}>
    {expressions.map((expression) => (
      <button
        type="button"
        className="personal-world-v2__expression-row"
        key={expression.id}
        onClick={() => onOpen(expression.personalMeaningId, expression.meaningFocusId)}
      >
        <span className="personal-world-v2__expression-word">{expression.surfaceForm}</span>
        <span className="personal-world-v2__expression-meta">
          {expressionTypeLabel(expression.expressionType)} · {languageLabel(expression.languageTag)}
        </span>
        {!compact && (
          <span className="personal-world-v2__expression-sense">
            <small>表达的意思</small>
            <b>{expression.sense}</b>
          </span>
        )}
        {!compact && (
          <span className="personal-world-v2__expression-source">
            来自：{expression.source}
          </span>
        )}
        <span className="personal-world-v2__expression-foot">
          <em>{compact ? '可加入学习' : `${relationLabel(expression.relation)} · ${coverageLabel(expression.semanticCoverage)}`}</em>
          {!compact && <b>可加入学习</b>}
          <i aria-hidden="true">→</i>
        </span>
      </button>
    ))}
  </div>
);

const WorldHome = ({
  meanings,
  expressions,
  onCreate,
  onBrowseMeanings,
  onBrowseExpressions,
  onOpen,
  onOpenConfirmedSense,
}: {
  meanings: readonly WorldMeaningView[];
  expressions: readonly BoundExpressionView[];
  onCreate: () => void;
  onBrowseMeanings: () => void;
  onBrowseExpressions: () => void;
  onOpen: (personalMeaningId: string, meaningFocusId?: string) => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
}) => {
  const activeMeanings = meanings.filter((meaning) =>
    meaning.senseFormation.phase !== 'sense_confirmed'
      || meaning.expressionBinding.phase === 'pending'
      || meaning.expressionBinding.phase === 'partial',
  );
  const visibleActiveMeanings = activeMeanings.slice(0, 3);
  const visibleExpressions = expressions.slice(0, 3);

  return (
    <>
      <section className="personal-world-v2__intro is-home">
        <div className="personal-world-v2__intro-copy">
          <h2>从一个真实经验开始</h2>
          <p>把场景里还说不清的意思，慢慢变成稳定的表达。</p>
        </div>
        <button type="button" className="personal-world-v2__create" onClick={onCreate}>
          <span className="personal-world-v2__create-symbol" aria-hidden="true">＋</span>
          <span><b>记录一个场景或经验</b><small>也可以从熟悉表达开始</small></span>
          <span className="personal-world-v2__create-arrow" aria-hidden="true">→</span>
        </button>
      </section>

      <section className="personal-world-v2__home-section">
        <header className="personal-world-v2__home-heading">
          <div>
            <small>正在形成</small>
            <h2>继续一个意思</h2>
          </div>
          {meanings.length > 0 && (
            <button type="button" onClick={onBrowseMeanings}>查看全部 {meanings.length}</button>
          )}
        </header>
        {visibleActiveMeanings.length > 0 ? (
          <ListView
            meanings={visibleActiveMeanings}
            emptyMode="filtered"
            preferBinding={false}
            onCreate={onCreate}
            onOpen={onOpen}
            onOpenConfirmedSense={onOpenConfirmedSense}
          />
        ) : (
          <div className="personal-world-v2__home-empty">
            <span aria-hidden="true">✓</span>
            <p>{meanings.length > 0 ? '当前没有需要继续形成的内容' : '记录第一个场景后，会从这里继续形成意思'}</p>
          </div>
        )}
        {activeMeanings.length > visibleActiveMeanings.length && (
          <button type="button" className="personal-world-v2__home-more" onClick={onBrowseMeanings}>
            还有 {activeMeanings.length - visibleActiveMeanings.length} 个意思待继续 <span aria-hidden="true">→</span>
          </button>
        )}
      </section>

      <section className="personal-world-v2__home-section is-expressions">
        <header className="personal-world-v2__home-heading">
          <div>
            <small>形成的结果</small>
            <h2>我的表达</h2>
          </div>
          {expressions.length > 0 && (
            <button type="button" onClick={onBrowseExpressions}>查看全部 {expressions.length}</button>
          )}
        </header>
        {visibleExpressions.length > 0 ? (
          <ExpressionRows
            expressions={visibleExpressions}
            compact
            onOpen={onOpenConfirmedSense}
          />
        ) : (
          <div className="personal-world-v2__home-empty is-expression">
            <span aria-hidden="true">↗</span>
            <p>完成 Sense 与表达绑定后，稳定表达会出现在这里</p>
          </div>
        )}
      </section>
    </>
  );
};

const ExpressionLibrary = ({
  expressions,
  search,
  onSearch,
  onOpen,
}: {
  expressions: readonly BoundExpressionView[];
  search: string;
  onSearch: (value: string) => void;
  onOpen: (personalMeaningId: string, meaningFocusId: string) => void;
}) => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleExpressions = expressions.filter((expression) => !normalizedSearch || [
    expression.surfaceForm,
    expression.sense,
    expression.source,
    expressionTypeLabel(expression.expressionType),
  ].join(' ').toLocaleLowerCase().includes(normalizedSearch));

  return (
    <section className="personal-world-v2__expression-library">
      <header className="personal-world-v2__library-heading">
        <small>已确认 Expression Binding</small>
        <h2>我的表达</h2>
        <p>这些表达已经连接到稳定 Sense，可以作为之后加入学习的语义基础。</p>
      </header>
      <div className="personal-world-v2__search">
        <span className="personal-world-v2__search-icon" aria-hidden="true">⌕</span>
        <label htmlFor="personal-world-expression-search" className="personal-world-v2__visually-hidden">搜索我的表达</label>
        <input
          id="personal-world-expression-search"
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索表达、Sense 或来源场景"
        />
        {search && (
          <button type="button" className="personal-world-v2__search-clear" onClick={() => onSearch('')} aria-label="清除搜索">×</button>
        )}
      </div>
      {visibleExpressions.length > 0 ? (
        <ExpressionRows expressions={visibleExpressions} onOpen={onOpen} />
      ) : (
        <div className="personal-world-v2__home-empty is-expression">
          <span aria-hidden="true">↗</span>
          <p>{expressions.length > 0 ? '没有匹配的表达' : '还没有完成 Binding 的表达'}</p>
        </div>
      )}
    </section>
  );
};

export const SensaSemanticWorldScreen = ({
  active,
  onBack,
  onOpenPersonalMeaning,
  onOpenConfirmedSense,
  toast,
}: SemanticWorldScreenProps) => {
  const [section, setSection] = useState<WorldSection>('home');
  const [view, setView] = useState<WorldView>('list');
  const [filter, setFilter] = useState<WorldFilter>('all');
  const [search, setSearch] = useState('');
  const [expressionSearch, setExpressionSearch] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const gateway = useJourneyGateway();
  const { items, status } = useJourneyWorld();
  const meanings = useMemo(() => items.map(worldMeaningFor), [items]);
  const expressions = useMemo(() => expressionsFor(meanings), [meanings]);

  const visibleMeanings = useMemo(() => meanings.filter((meaning) => {
    const matchesFilter = filter === 'all'
      || (filter === 'continue' && meaning.senseFormation.phase !== 'sense_confirmed')
      || (filter === 'binding'
        && (meaning.expressionBinding.phase === 'pending' || meaning.expressionBinding.phase === 'partial'))
      || (filter === 'complete' && meaning.expressionBinding.phase === 'bound');
    return matchesFilter && meaningMatchesQuery(meaning, search);
  }), [filter, meanings, search]);

  const emptyMode = meanings.length === 0 ? 'world' : 'filtered';
  const openMeaning = (personalMeaningId: string, meaningFocusId?: string) =>
    onOpenPersonalMeaning(personalMeaningId, meaningFocusId);
  const handleCreated = (personalMeaningId: string) => {
    setComposerOpen(false);
    onOpenPersonalMeaning(personalMeaningId);
  };
  const returnFromSection = () => {
    setSection('home');
    setSearch('');
    setExpressionSearch('');
  };

  return (
    <section
      className={`screen semantic-world-screen personal-world-v2${active ? ' active' : ''}`}
      id="s-semantic-world"
      data-anim="slide"
    >
      <header className="personal-world-v2__nav">
        <button
          type="button"
          className="personal-world-v2__back"
          onClick={section === 'home' ? onBack : returnFromSection}
          aria-label={section === 'home' ? '返回我的内容' : '返回我的词义世界首页'}
        >
          <svg className="icon" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <div className="personal-world-v2__nav-title">
          <h1>{section === 'home' ? '我的词义世界' : section === 'expressions' ? '我的表达' : '全部意思'}</h1>
        </div>
        <span className="personal-world-v2__nav-mark" aria-hidden="true">◌</span>
      </header>

      <div className="personal-world-v2__body">
        {!status.ok ? (
          <WorldErrorState error={status.error} onReload={() => gateway.reload()} />
        ) : section === 'home' ? (
          <WorldHome
            meanings={meanings}
            expressions={expressions}
            onCreate={() => setComposerOpen(true)}
            onBrowseMeanings={() => setSection('meanings')}
            onBrowseExpressions={() => setSection('expressions')}
            onOpen={openMeaning}
            onOpenConfirmedSense={onOpenConfirmedSense}
          />
        ) : section === 'expressions' ? (
          <ExpressionLibrary
            expressions={expressions}
            search={expressionSearch}
            onSearch={setExpressionSearch}
            onOpen={onOpenConfirmedSense}
          />
        ) : (
          <>
            <div className="personal-world-v2__search">
              <span className="personal-world-v2__search-icon" aria-hidden="true">⌕</span>
              <label htmlFor="personal-world-search" className="personal-world-v2__visually-hidden">搜索我的词义世界</label>
              <input
                id="personal-world-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索经验、Focus、表达或 Sense"
              />
              {search && (
                <button type="button" className="personal-world-v2__search-clear" onClick={() => setSearch('')} aria-label="清除搜索">×</button>
              )}
            </div>
            <div className="personal-world-v2__controls">
              <div className="personal-world-v2__view-tabs" role="tablist" aria-label="词义世界呈现方式">
                <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')}>清单</button>
                <button type="button" role="tab" aria-selected={view === 'expanded'} className={view === 'expanded' ? 'is-active' : ''} onClick={() => setView('expanded')}>展开</button>
                <button type="button" role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'is-active' : ''} onClick={() => setView('graph')}>图谱</button>
              </div>
              <div className="personal-world-v2__filters" role="group" aria-label="按下一步筛选 Personal Meaning">
                {([
                  { key: 'all' as const, label: '全部', count: meanings.length },
                  { key: 'continue' as const, label: '待继续', count: meanings.filter((meaning) => meaning.senseFormation.phase !== 'sense_confirmed').length },
                  { key: 'binding' as const, label: '待绑定表达', count: meanings.filter((meaning) => meaning.expressionBinding.phase === 'pending' || meaning.expressionBinding.phase === 'partial').length },
                  { key: 'complete' as const, label: '已连接', count: meanings.filter((meaning) => meaning.expressionBinding.phase === 'bound').length },
                ]).map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={`personal-world-v2__filter is-${option.key}${filter === option.key ? ' is-active' : ''}`}
                    aria-pressed={filter === option.key}
                    onClick={() => setFilter(option.key)}
                  >
                    <span>{option.label}</span><small>{option.count}</small>
                  </button>
                ))}
              </div>
            </div>
            {view === 'graph' ? (
              <GraphView
                meanings={visibleMeanings}
                emptyMode={emptyMode}
                onCreate={() => setComposerOpen(true)}
                onOpen={openMeaning}
                onOpenConfirmedSense={onOpenConfirmedSense}
              />
            ) : view === 'expanded' ? (
              <ExpandedView
                meanings={visibleMeanings}
                emptyMode={emptyMode}
                onCreate={() => setComposerOpen(true)}
                onOpen={openMeaning}
                onOpenConfirmedSense={onOpenConfirmedSense}
              />
            ) : (
              <ListView
                meanings={visibleMeanings}
                emptyMode={emptyMode}
                preferBinding={filter === 'binding'}
                onCreate={() => setComposerOpen(true)}
                onOpen={openMeaning}
                onOpenConfirmedSense={onOpenConfirmedSense}
              />
            )}
          </>
        )}

      </div>

      <PersonalMeaningComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={handleCreated}
        onSaved={toast}
      />
    </section>
  );
};
