/** No login, mutation, provider request or user data. */
import {verifyHostedApi,verifyHostedWeb,verifyHostedYouglishPlayer} from './hostedChecks.mjs';

const web=await verifyHostedWeb(process.env.SENSA_WEB_ORIGIN);
await verifyHostedApi(web,process.env.VITE_SENSA_API_URL);
await verifyHostedYouglishPlayer(web,process.env.VITE_SENSA_YOUGLISH_ORIGIN);
console.log('PASS: public routes, isolated YouGlish shell, offline shell headers, API auth boundary and Web CORS. Real login, model quality and deletion require separate acceptance.');
