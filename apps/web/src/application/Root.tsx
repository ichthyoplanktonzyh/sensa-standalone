import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import AccountExperience from '../experience/account/AccountExperience';

const Screen = lazy(() => import('../experience/App'));

export default function Root() {
  const { t } = useTranslation();
  return <Suspense fallback={<main role="status">{t('reliability.loading')}</main>}><AccountExperience><Screen/></AccountExperience></Suspense>;
}
