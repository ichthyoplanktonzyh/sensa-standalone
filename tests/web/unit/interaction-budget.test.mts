import {expect,test,vi} from 'vitest';
import {assertInteractionBudget} from '../support/interactionBudget';

test('tiny single-sample overruns retain the missed target and emit a release warning',()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  expect(assertInteractionBudget(458,500,'restore')).toEqual({label:'restore',elapsedMs:458,targetMs:500,warningBandMs:25,status:'within-target'});
  const result=assertInteractionBudget(505.3,500,'restore');
  expect(result).toEqual({label:'restore',elapsedMs:505.3,targetMs:500,warningBandMs:25,status:'warning'});
  expect(warning).toHaveBeenCalledExactlyOnceWith('PERFORMANCE_WARNING',JSON.stringify(result));
 }finally{warning.mockRestore();}
});

test('the relative warning band retains small overruns but rejects meaningful regressions',()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{
  expect(assertInteractionBudget(52.5,50,'short')).toMatchObject({warningBandMs:2.5,status:'warning'});
  expect(()=>assertInteractionBudget(53,50,'short')).toThrow(/exceeds/);
  expect(assertInteractionBudget(1538,1500,'reload')).toMatchObject({warningBandMs:75,status:'warning'});
  expect(()=>assertInteractionBudget(1576,1500,'reload')).toThrow(/exceeds/);
  expect(assertInteractionBudget(6300,6000,'install')).toMatchObject({warningBandMs:300,status:'warning'});
  expect(()=>assertInteractionBudget(6301,6000,'install')).toThrow(/exceeds/);
  expect(()=>assertInteractionBudget(8993,6000,'install')).toThrow(/exceeds/);
 }finally{warning.mockRestore();}
});

test.each([NaN,Infinity,-1])('invalid elapsed value %s cannot turn into a passing result',elapsed=>{
 expect(()=>assertInteractionBudget(elapsed,500,'restore')).toThrow(/invalid/);
});
test.each([NaN,Infinity,0,-1])('invalid target %s cannot disable a performance guard',target=>{
 expect(()=>assertInteractionBudget(505.3,target,'restore')).toThrow(/invalid/);
});
