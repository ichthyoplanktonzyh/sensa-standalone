import {describe,expect,it} from 'vitest';

import {settleOperation} from '../../../apps/web/src/experience/library/operationSettlement';

describe('local operation settlement',()=>{
  it('does not turn a committed intent into a failure when projection refresh fails',async()=>{
    const committed={targetId:'target-1'};
    const outcome=await settleOperation(
      async()=>committed,
      async()=>{throw new Error('projection unavailable');},
    );

    expect(outcome).toMatchObject({kind:'committed',value:committed,projection:'stale'});
  });

  it('keeps command rejection distinct from refresh state',async()=>{
    const rejected=new Error('command rejected');
    let refreshed=false;
    const outcome=await settleOperation(
      async()=>{throw rejected;},
      async()=>{refreshed=true;},
    );

    expect(outcome).toEqual({kind:'rejected',error:rejected});
    expect(refreshed).toBe(false);
  });
});
