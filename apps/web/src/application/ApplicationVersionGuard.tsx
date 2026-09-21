import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../i18n/versionResources';

type VersionNotice = 'library' | 'update' | null;

/** Keeps a page from writing through a stale cross-tab or Service Worker protocol. */
export function ApplicationVersionGuard() {
  const { t } = useTranslation('version');
  const [notice, setNotice] = useState<VersionNotice>(() =>
    document.documentElement.dataset.libraryVersion === 'incompatible'
      ? 'library'
      : document.documentElement.dataset.appUpdate === 'ready'
        ? 'update'
        : null,
  );

  useEffect(() => {
    const library = () => setNotice('library');
    const update = () => setNotice((current) => current ?? 'update');
    window.addEventListener('sensa-library-version-incompatible', library);
    window.addEventListener('sensa-app-update-ready', update);
    return () => {
      window.removeEventListener('sensa-library-version-incompatible', library);
      window.removeEventListener('sensa-app-update-ready', update);
    };
  }, []);

  if (!notice) return null;
  const library = notice === 'library';
  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] p-4 sm:p-6" role="alert" data-sensa-version-guard={notice}>
      <section className="mx-auto max-w-2xl rounded-card border border-border-subtle bg-surface-panel p-5 shadow-raised">
        <h2 className="text-lg font-medium text-fg-primary">
          {t(library ? 'conflictTitle' : 'updateTitle')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-fg-secondary">
          {t(library ? 'conflictDescription' : 'updateDescription')}
        </p>
        <button
          type="button"
          className="mt-4 min-h-11 rounded-control bg-action-primary px-5 text-sm font-medium text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          onClick={() => {
            if (library) window.location.reload();
            else window.dispatchEvent(new Event('sensa-activate-app-update'));
          }}
        >
          {library ? t('reliability.reload', { ns: 'common' }) : t('updateNow')}
        </button>
      </section>
    </div>
  );
}
