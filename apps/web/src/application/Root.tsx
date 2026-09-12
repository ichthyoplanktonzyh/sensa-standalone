import { lazy, Suspense } from 'react';
import AccountExperience from '../experience/account/AccountExperience';

const Screen = lazy(() => import('../experience/App'));

export default function Root() {
  return <Suspense fallback={<main role="status">正在加载 Sensa…</main>}><AccountExperience><Screen/></AccountExperience></Suspense>;
}
