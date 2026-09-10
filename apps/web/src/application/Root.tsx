import { lazy, Suspense } from 'react';

// The complete application is the product entry in both development and release
// builds. Keep the migration-era account client available only for its explicit
// regression build; local use must not depend on authentication or an API.
const Screen = import.meta.env.VITE_SENSA_MODE === 'legacy-account'
  ? lazy(() => import('../experience/account/SensaApp'))
  : lazy(() => import('../experience/App'));

export default function Root() {
  return <Suspense fallback={<main role="status">正在加载 Sensa…</main>}><Screen/></Suspense>;
}
