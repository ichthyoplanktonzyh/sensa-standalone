import '../../i18n/contentResources';
import {useTranslation} from 'react-i18next';
import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
interface ContentComingSoonScreenProps {
  active: boolean;
  kind: 'scenes' | 'collections';
  onBack: () => void;
}

export const ContentComingSoonScreen = ({ active, kind, onBack }: ContentComingSoonScreenProps) => {
  const {t}=useTranslation('content');
  const page={scenes:{glyph:'◌'},collections:{glyph:'⌘'}}[kind];
  const key=`coming.${kind}`;
  return (
    <section className={slideScreenClass(active)} id="s-content-coming" data-anim="slide" aria-hidden={!active}>
      <header className={contentNavigationClass}>
        <button className={contentNavigationBackClass} onClick={onBack} aria-label={t('content.backToMyContent')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{t(`${key}.title`)}</h1>
        <span />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-8 py-12 text-center sm:px-12">
        <div className="relative mb-8 grid size-36 place-items-center overflow-hidden rounded-overlay border border-border-subtle bg-accent-soft text-action-primary" aria-hidden="true">
          <span>{page.glyph}</span>
          <i className="absolute left-7 top-8 size-3 rounded-full bg-progress" />
          <i className="absolute right-6 top-14 size-3 rounded-full bg-decorative" />
          <i className="absolute bottom-6 left-14 size-3 rounded-full bg-action-primary" />
        </div>
        <span className="text-metadata font-bold tracking-[0.16em] text-fg-tertiary">{t(`${key}.eyebrow`)}</span>
        <h2 className="mt-2 text-page-title font-semibold">{t(`${key}.title`)}</h2>
        <p className="mt-3 max-w-lg text-body-support leading-7 text-fg-secondary">{t(`${key}.description`)}</p>
        <div className="mt-7 w-full rounded-card border border-border-subtle bg-surface-panel px-4 text-left">
          {([1,2,3] as const).map(index => (
            <div className="flex min-h-12 items-center gap-3 border-border-subtle text-body-support text-fg-secondary [&+div]:border-t" key={index}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-metadata font-bold text-feedback-success">✓</span>
              {t(`${key}.point${index}`)}
            </div>
          ))}
        </div>
        <div className="mt-7 rounded-pill bg-surface-subtle px-4 py-2 text-control-label font-semibold text-fg-secondary">{t('coming.unavailable')}</div>
        <small className="mt-3 max-w-md text-metadata leading-5 text-fg-tertiary">{t('coming.note')}</small>
      </div>
    </section>
  );
};
