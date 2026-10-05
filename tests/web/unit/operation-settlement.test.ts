import {describe,expect,it} from 'vitest';

import {settleOperation,settleReconciledOperation} from '../../../apps/web/src/experience/library/operationSettlement';

describe('local operation settlement',()=>{
  it('rereads after a missing receipt without replaying the command or claiming success',async()=>{
    let calls=0,reads=0;const error=new Error('response lost');
    const result=await settleReconciledOperation(async()=>{calls++;throw error;},async()=>{reads++;});
    expect(result).toEqual({kind:'unconfirmed',error,projection:'current'});expect(calls).toBe(1);expect(reads).toBe(1);
  });
  it('preserves receipt uncertainty when the recovery read also fails',async()=>{
    const error=new Error('write or receipt failure'),refreshError=new Error('read unavailable');
    expect(await settleReconciledOperation(async()=>{throw error;},async()=>{throw refreshError;})).toEqual({kind:'unconfirmed',error,projection:'stale',refreshError});
  });
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
