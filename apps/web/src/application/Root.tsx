import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cachedAuthSubject, hasAuthCallback } from '../data/account/authSessionHint';
import { pendingAccountDeletion } from '../experience/account/accountDeletionState';
import { LandingPage } from '../experience/landing/LandingPage';

const AccountExperience = lazy(async() => {
  const [module]=await Promise.all([
    import('../experience/account/AccountExperience'),
    import('../i18n/accountResources'),
  ]);
  return module;
});
const Screen = lazy(() => import('../experience/App'));

export default function Root() {
  const { t } = useTranslation();
  const [accountRequested, setAccountRequested] = useState(false);
  const sessionHint = cachedAuthSubject();
  const landingPreview = location.pathname === '/welcome';
  const publicLanding = !accountRequested
    && !pendingAccountDeletion()
    && !hasAuthCallback()
    && (landingPreview || (location.pathname === '/' && sessionHint === null));
  if (publicLanding) {
    return <LandingPage signedIn={sessionHint !== null} onEnter={() => setAccountRequested(true)} />;
  }
  return <Suspense fallback={<main role="status">{t('reliability.loading')}</main>}><AccountExperience onReturnToLanding={() => setAccountRequested(false)}><Screen/></AccountExperience></Suspense>;
}
