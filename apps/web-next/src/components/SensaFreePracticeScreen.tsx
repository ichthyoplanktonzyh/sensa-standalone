import { useMemo } from 'react';
import {
  resolvePracticeActivities,
  type ResolvedPracticeActivity,
} from '../practiceInventory';
import type { AcademyScreenProps } from './AcademyScreen';

const activityStatusLabel = (activity: ResolvedPracticeActivity): string => {
  switch (activity.status) {
    case 'available':
      return '开始练习';
    case 'unavailable_in_scope':
      return '范围为空';
    case 'not_yet_delivered':
      return '待接入';
  }
};

const PracticeActivityCard = ({
  activity,
  onEnter,
}: {
  activity: ResolvedPracticeActivity;
  onEnter: () => void;
}) => {
  const available = activity.status === 'available';

  return (
    <button
      type="button"
      className={`sensa-practice-activity area-${activity.primaryArea} is-${activity.status}`}
      disabled={!available}
      onClick={onEnter}
      aria-label={`${activity.areaLabel}，${activity.name}，${activityStatusLabel(activity)}`}
    >
      <span className="sensa-practice-activity-top">
        <span className="sensa-practice-activity-icon" aria-hidden="true">
          <svg className="icon"><use href={activity.iconHref} /></svg>
        </span>
        <span className="sensa-practice-area-label">
          {activity.areaLabel}
          {!available && <em>{activityStatusLabel(activity)}</em>}
        </span>
      </span>

      <span className="sensa-practice-activity-name">{activity.name}</span>
      <span className="sensa-practice-activity-cue">{activity.cue}</span>

      {available && (
        <span className="sensa-practice-activity-arrow" aria-hidden="true">
          <svg className="icon"><use href="#i-chev-r" /></svg>
        </span>
      )}
    </button>
  );
};

export const SensaFreePracticeScreen = ({
  active,
  onBack,
  onOpenPracticeScope,
  onOpenRealWorldListening,
  practiceScope,
}: AcademyScreenProps) => {
  const activities = useMemo(
    () => resolvePracticeActivities(practiceScope),
    [practiceScope],
  );
  const scopePreview = useMemo(() => {
    const forms = [...new Set(
      practiceScope.targets.map((target) => target.expression.surfaceForm.trim()).filter(Boolean),
    )];
    if (forms.length === 0) return '当前没有可练目标';
    const visible = forms.slice(0, 4).join(' · ');
    return forms.length > 4 ? `${visible} · +${forms.length - 4}` : visible;
  }, [practiceScope.targets]);

  const enter = (activity: ResolvedPracticeActivity) => {
    if (activity.id === 'real_world_speech_variation') {
      onOpenRealWorldListening();
    }
  };

  return (
    <section
      className={`screen sensa-practice${active ? ' active' : ''}`}
      id="s-academy"
      data-anim="sheet"
    >
      <header className="sensa-practice-nav">
        <button className="sensa-practice-back" onClick={onBack} aria-label="返回首页">
          <svg className="icon"><use href="#i-chev-d" /></svg>
        </button>
        <h1>自由练习</h1>
      </header>

      <div className="sensa-practice-body">
        <button
          type="button"
          className="sensa-practice-scope"
          onClick={onOpenPracticeScope}
          aria-label={`当前练习范围，${practiceScope.title}，${practiceScope.targets.length} 个目标`}
        >
          <span className="sensa-practice-scope-copy">
            <span>练习范围 · {practiceScope.title}</span>
            <strong>{scopePreview}</strong>
          </span>
          <span className="sensa-practice-scope-meta">
            {practiceScope.targets.length} 个目标
            <svg className="icon"><use href="#i-chev-r" /></svg>
          </span>
        </button>

        <div className="sensa-practice-activities" aria-label="练习活动">
          {activities.map((activity) => (
            <PracticeActivityCard
              key={activity.id}
              activity={activity}
              onEnter={() => enter(activity)}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
