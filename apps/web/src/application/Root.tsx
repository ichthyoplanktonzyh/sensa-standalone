import { lazy, Suspense } from 'react';
const Preview=lazy(()=>import('../experience/App'));
const Account=lazy(()=>import('../experience/account/SensaApp'));
export default function Root(){
 const Screen=import.meta.env.VITE_SENSA_MODE==='preview'&&!new URLSearchParams(location.search).has('library')?Preview:Account;
 return <Suspense fallback={<main role="status">正在加载 Sensa…</main>}><Screen/></Suspense>;
}
