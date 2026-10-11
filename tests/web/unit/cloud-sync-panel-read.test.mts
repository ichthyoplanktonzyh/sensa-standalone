import {describe,it,expect} from 'vitest';
import {readCloudSyncPanel,cloudSyncPanelMessage} from '../../../apps/web/src/experience/components/cloudSyncPanelRead';
import type {CloudSyncState} from '../../../apps/web/src/data/library/cloudSync';

describe('Sync panel reads only confirmed status',()=>{
 it('a failed read returns unknown without a pending fallback',async()=>{
  const read=await readCloudSyncPanel(async()=>{throw new Error('unavailable');});
  expect(read).toEqual({availability:'error'});
  expect(cloudSyncPanelMessage(read)).toBe('account.unknown');
  expect(cloudSyncPanelMessage({availability:'loading'})).toBe('reliability.loading');
 });
 it('a reread presents the actual saved pending state',async()=>{
  const state={status:'pending'} as CloudSyncState;
  const read=await readCloudSyncPanel(async()=>[state,false]);
  expect(cloudSyncPanelMessage(read)).toBe('cloudSync.pending');
  expect(read).toEqual({availability:'ready',state,reconnectRequired:false});
 });
 it('missing state stays unknown and a paused local copy stays local',async()=>{
  expect(cloudSyncPanelMessage(await readCloudSyncPanel(async()=>[undefined,false]))).toBe('account.unknown');
  expect(cloudSyncPanelMessage(await readCloudSyncPanel(async()=>[undefined,true]))).toBe('account.localSync');
 });
});
