/** No login, mutation, provider request or user data. */
import {verifyHostedApi,verifyHostedWeb} from './hostedChecks.mjs';

const web=await verifyHostedWeb(process.env.SENSA_WEB_ORIGIN);
await verifyHostedApi(web,process.env.VITE_SENSA_API_URL);
console.log('PASS: public routes, offline shell headers, public package catalog, protected Agent exchange and Web CORS. Real login, external media, model quality and deletion require separate acceptance.');
