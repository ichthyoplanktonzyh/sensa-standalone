import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cachedAuthSubject, hasAuthCallback } from '../data/account/authSessionHint';
import {hasLocalLibraryHint} from '../data/library/localLibraryHint';
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
const HowItWorksPage = lazy(() => import('../experience/landing/HowItWorksPage'));

export default function Root() {
  const { t } = useTranslation();
  const [accountRequested, setAccountRequested] = useState(false);
  const sessionHint = cachedAuthSubject();
  const landingPreview = location.pathname === '/welcome';
  const howItWorks = location.pathname === '/how-it-works';
  const publicLanding = !accountRequested
    && !pendingAccountDeletion()
    && !hasAuthCallback()
    && (landingPreview || howItWorks || (location.pathname === '/' && sessionHint === null && !hasLocalLibraryHint()));
  if (publicLanding) {
    if (howItWorks) {
      return <Suspense fallback={<main role="status">{t('reliability.loading')}</main>}><HowItWorksPage signedIn={sessionHint !== null} onEnter={() => setAccountRequested(true)} /></Suspense>;
    }
    return <LandingPage signedIn={sessionHint !== null} onEnter={() => setAccountRequested(true)} />;
  }
  return <Suspense fallback={<main role="status">{t('reliability.loading')}</main>}><AccountExperience onReturnToLanding={() => setAccountRequested(false)}><Screen/></AccountExperience></Suspense>;
}
