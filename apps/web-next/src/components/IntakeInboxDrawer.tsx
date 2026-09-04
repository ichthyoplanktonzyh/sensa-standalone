/**
 * 待处理材料盒（Inbox）抽屉。
 *
 * 慢轨摄取材料的处理台：每张卡片呈现原文摘要、来源与附带媒体，轻点候选
 * 义项即走快轨结案落库；「召唤 AI」先把材料建成 Meaning（材料本身成为
 * 澄清会话的语境）再移出 Inbox；「丢弃」直接移除。组件只发意图，所有
 * 写入都经过 gateway 的幂等命令。
 */

import { useEffect, useState } from 'react';
import type { SensaIntakeItem, SensaIntakeSense } from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';
import { useJourneyGateway } from '../personalMeaningJourney';

interface IntakeInboxDrawerProps {
  open: boolean;
  items: SensaIntakeItem[];
  onClose: () => void;
  /** 召唤 AI 成功后回调：关闭抽屉并打开新 Meaning 的澄清会话。 */
  onSummoned: (personalMeaningId: string) => void;
  toast: (message: string) => void;
}

const statusLabels: Record<SensaIntakeItem['status'], string> = {
  pending_sense: '待确认词义',
  pending_expression: '待圈定表达',
};

interface DisambiguationOption {
  senseKey: string | null;
  definitionSummary: string;
}

/**
 * Quick-disambiguation options come from the captured payload itself: the
 * draft sense (if one was carried as a candidate) plus its alternatives.
 * Only `pending_sense` items have an expression, so only they can resolve.
 */
const disambiguationOptions = (item: SensaIntakeItem): DisambiguationOption[] => {
  if (item.status !== 'pending_sense') return [];
  const sense = item.payload.sense;
  if (!sense) return [];
  const options: DisambiguationOption[] = [
    { senseKey: sense.senseKey, definitionSummary: sense.definitionSummary },
  ];
  for (const candidate of sense.candidates) {
    if (candidate.definitionSummary !== sense.definitionSummary) {
      options.push({
        senseKey: candidate.senseKey,
        definitionSummary: candidate.definitionSummary,
      });
    }
  }
  return options;
};

export const IntakeInboxDrawer = ({
  open,
  items,
  onClose,
  onSummoned,
  toast,
}: IntakeInboxDrawerProps) => {
  const gateway = useJourneyGateway();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const resolve = async (item: SensaIntakeItem, option: DisambiguationOption) => {
    setBusyId(item.intakeId);
    try {
      const sense: SensaIntakeSense = {
        senseKey: option.senseKey,
        confirmationStatus: 'user_confirmed',
        definitionSummary: option.definitionSummary,
        wordingSource: item.payload.sense?.wordingSource ?? 'learner_authored',
        candidates: [],
      };
      const result = await gateway.resolveInboxItem(newUuid(), item.intakeId, { sense });
      toast(result.route === 'fast_track'
        ? '已确认词义，材料已收进词义世界'
        : '这条材料还不能结案，请换一个义项试试。');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : '暂时无法处理这条材料。');
    } finally {
      setBusyId(null);
    }
  };

  const summon = async (item: SensaIntakeItem) => {
    const text = item.payload.context.textSegment?.trim();
    if (!text) return;
    setBusyId(item.intakeId);
    try {
      // The captured context becomes the material; the AI interview opens on
      // it right away, so the item leaves the Inbox in the same gesture.
      const created = await gateway.createPersonalMeaning({
        operationId: newUuid(),
        blocks: [{ kind: 'text', bodyText: text }],
        startingPoint: item.status === 'pending_sense' ? 'from_expression' : 'from_experience',
      });
      await gateway.dismissInboxItem(newUuid(), item.intakeId);
      onSummoned(created.personalMeaningId);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : '暂时无法召唤 AI。');
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (item: SensaIntakeItem) => {
    setBusyId(item.intakeId);
    try {
      await gateway.dismissInboxItem(newUuid(), item.intakeId);
      toast('已丢弃这条材料');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : '暂时无法丢弃。');
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="intake-layer" onMouseDown={onClose}>
      <section
        className="intake-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intake-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="intake-drawer__grip" aria-hidden="true" />
        <header className="intake-drawer__head">
          <div>
            <small>待处理材料盒</small>
            <h2 id="intake-drawer-title">捕获的材料（{items.length}）</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="intake-drawer__body">
          <p className="intake-drawer__hint">
            生活与阅读中随手捕获、还差一步确认的材料。补齐后即进入词义世界。
          </p>
          {items.map((item) => {
            const busy = busyId === item.intakeId || busyId != null;
            const options = disambiguationOptions(item);
            const source = item.payload.context.source;
            const mediaCount = item.payload.context.mediaReferenceIds.length;
            const hasText = Boolean(item.payload.context.textSegment?.trim());
            return (
              <article className="intake-card" key={item.intakeId}>
                <header className="intake-card__head">
                  <span className={`intake-card__status is-${item.status}`}>
                    {statusLabels[item.status]}
                  </span>
                  {mediaCount > 0 && (
                    <span className="intake-card__media">
                      <span aria-hidden="true">🖼</span> 附带 {mediaCount} 张图片
                    </span>
                  )}
                </header>
                <p className="intake-card__summary">{item.summaryView}</p>
                {source && (
                  <p className="intake-card__source">
                    来自网页：{source.title ?? source.url ?? '未知来源'}
                  </p>
                )}
                {options.length > 0 && (
                  <div className="intake-card__options" role="group" aria-label="快速消歧：轻点候选义项直接结案">
                    {options.map((option, index) => (
                      <button
                        type="button"
                        key={`${option.definitionSummary}-${index}`}
                        disabled={busy}
                        onClick={() => void resolve(item, option)}
                      >
                        {option.definitionSummary}
                      </button>
                    ))}
                  </div>
                )}
                <footer className="intake-card__actions">
                  <button
                    type="button"
                    className="intake-card__summon"
                    disabled={busy || !hasText}
                    onClick={() => void summon(item)}
                  >
                    召唤 AI
                  </button>
                  <button
                    type="button"
                    className="intake-card__discard"
                    disabled={busy}
                    onClick={() => void discard(item)}
                  >
                    丢弃
                  </button>
                </footer>
              </article>
            );
          })}
          {items.length === 0 && (
            <div className="intake-drawer__empty">
              <span aria-hidden="true">✓</span>
              <p>材料盒已清空，捕获的材料都会先出现在这里</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
