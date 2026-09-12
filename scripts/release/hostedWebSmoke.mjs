import {verifyHostedWeb} from './hostedChecks.mjs';

await verifyHostedWeb(process.env.SENSA_WEB_ORIGIN);
console.log('PASS: public Web routes and offline shell headers. API and user journeys require their separate checks.');
