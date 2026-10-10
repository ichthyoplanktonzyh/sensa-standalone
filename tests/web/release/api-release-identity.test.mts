import {test,expect} from 'vitest';
import {createConsumerRoutes} from '../../../apps/api/src/sensa/access/consumer';

test('API build identity is public, unversioned locally, and never reads identity, data or a runtime SHA',async()=>{
  const old=process.env.SENSA_RELEASE_SHA;
  process.env.SENSA_RELEASE_SHA='f'.repeat(40);
  try{
    const app=createConsumerRoutes({verify:async()=>{throw Error('must not authenticate');},transaction:async()=>{throw Error('must not access user data');}});
    const response=await app.request('/sensa/release');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({format:'sensa-api-release-v1',commit:null});
  }finally{if(old===undefined)delete process.env.SENSA_RELEASE_SHA;else process.env.SENSA_RELEASE_SHA=old;}
});
