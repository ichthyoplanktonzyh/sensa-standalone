import { lazy, Suspense } from 'react';
const Screen=import.meta.env.VITE_SENSA_MODE==='preview'
  ? lazy(()=>import('../experience/App'))
  : lazy(()=>import('../experience/account/SensaApp'));
export default function Root(){return <Suspense fallback={<main role="status">正在加载 Sensa…</main>}><Screen/></Suspense>;}
