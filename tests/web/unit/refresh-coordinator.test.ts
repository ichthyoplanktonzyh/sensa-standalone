import {describe,expect,it} from 'vitest';

import {createRefreshCoordinator} from '../../../apps/web/src/experience/library/refreshCoordinator';

describe('learning refresh coordination',()=>{
 it('coalesces one notification burst into one projection read',async()=>{
  let reads=0;
  const coordinator=createRefreshCoordinator(async()=>{reads++;});

  await Promise.all([coordinator.request(),coordinator.request(),coordinator.request()]);

  expect(reads).toBe(1);
 });

 it('runs one follow-up when a write notification arrives during a read',async()=>{
  let reads=0;
  let release!:()=>void;
  const firstRead=new Promise<void>(resolve=>{release=resolve;});
  const coordinator=createRefreshCoordinator(async()=>{
   reads++;
   if(reads===1)await firstRead;
  });

  const first=coordinator.request();
  await Promise.resolve();
  const changedDuringRead=coordinator.request();
  release();
  await Promise.all([first,changedDuringRead]);

 expect(reads).toBe(2);
 });

 it('honors a newer notification after an in-flight read fails',async()=>{
  let reads=0;
  let release!:()=>void;
  const firstRead=new Promise<void>(resolve=>{release=resolve;});
  const coordinator=createRefreshCoordinator(async()=>{
   reads++;
   if(reads===1){await firstRead;throw new Error('stale read');}
  });

  const first=coordinator.request();
  await Promise.resolve();
  const changedDuringRead=coordinator.request();
  release();
  await Promise.all([first,changedDuringRead]);

  expect(reads).toBe(2);
 });
});
