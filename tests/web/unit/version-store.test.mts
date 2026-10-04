import {test,expect} from 'vitest';
import {createVersionStore} from '../../../apps/web/src/experience/services/createSnapshotStore.ts';

test('a source change between render and subscription invalidates the rendered version',()=>{
  let changed:(()=>void)|undefined,source='not loaded';
  const store=createVersionStore(listener=>{changed=listener;return()=>{changed=undefined;};});
  const rendered=store.getSnapshot(),selected=source;
  source='durably loaded before React subscribed';
  const detach=store.subscribe(()=>{});
  expect(store.getSnapshot()).toBeGreaterThan(rendered);
  expect(source).not.toBe(selected);
  const subscribed=store.getSnapshot();changed!();expect(store.getSnapshot()).toBe(subscribed+1);detach();
});

test('listeners share one source connection and reattachment refreshes changes missed while detached',()=>{
  let connects=0,disconnects=0,sourceChange:(()=>void)|undefined;
  const store=createVersionStore(listener=>{connects++;sourceChange=listener;return()=>{disconnects++;sourceChange=undefined;};});
  const first=store.subscribe(()=>{}),connected=store.getSnapshot(),second=store.subscribe(()=>{});
  expect(connects).toBe(1);expect(store.getSnapshot()).toBe(connected);
  first();expect(disconnects).toBe(0);second();expect(disconnects).toBe(1);
  expect(sourceChange).toBeUndefined();
  const detached=store.getSnapshot(),third=store.subscribe(()=>{});
  expect(store.getSnapshot()).toBeGreaterThan(detached);expect(connects).toBe(2);third();expect(disconnects).toBe(2);
});
