/** Expression material interface; controlled reads, no formal Learning or provider calls. */
import {test,expect,vi,afterEach} from 'vitest';
import {practiceMaterialsRepository,collectPracticeExpressionIds,resolvePracticeExpression} from '../../../apps/web/src/experience/practiceMaterials';
import {practiceExpressionId,type PracticeExpression} from '../../../apps/web/src/data/library/practiceExpressionProjection';
afterEach(()=>vi.restoreAllMocks());
const expression=(index:number):PracticeExpression=>({id:`expression-${index}`,text:`word-${index}`,languageTag:'en',source:{kind:'personal',id:`owner-${index}`}});
test('practice-scope',async()=>{
 expect(practiceExpressionId('  BANK ','en')).toBe(practiceExpressionId('bank','en'));
 expect(practiceExpressionId('bank','en')).not.toBe(practiceExpressionId('bank','de'));
 expect(practiceExpressionId('A long personal expression with private wording','en')).toMatch(/^[a-f0-9-]{36}$/u);
 const read=vi.spyOn(practiceMaterialsRepository,'page').mockResolvedValue({incarnation:'one',revision:1,total:10_000,items:[expression(0)],ids:[expression(0).id]});
 expect(await resolvePracticeExpression({source:'personal',expressionIds:null},'en')).toEqual(expression(0));
 expect(read.mock.calls[0]![0]).toEqual({source:'personal',languageTag:'en',query:'',offset:0,limit:1,selectedIds:undefined});
 await resolvePracticeExpression({source:'personal',expressionIds:Array.from({length:10_000},(_,index)=>expression(index).id)},'en',expression(0).id);
 expect(read.mock.calls[1]![0].selectedIds).toEqual([expression(0).id]);
 await expect(resolvePracticeExpression({source:'personal',expressionIds:['chosen']},'en','other')).rejects.toThrow('practice_expression_not_selected');expect(read).toHaveBeenCalledTimes(2);
 read.mockResolvedValueOnce({incarnation:'one',revision:1,total:0,items:[],ids:[]});
 expect(await resolvePracticeExpression({source:'books',expressionIds:[]},'en')).toBeNull();
});
test('explicit select-all reads only bounded identity pages, never complete material bodies',async()=>{
 const ids=Array.from({length:10_000},(_,index)=>`id-${index}`);
 const read=vi.spyOn(practiceMaterialsRepository,'page').mockImplementation(async query=>({incarnation:'one',revision:1,total:ids.length,items:[],ids:ids.slice(query.offset,query.offset+query.limit)}));
 expect(await collectPracticeExpressionIds({source:'personal',languageTag:'en',query:''},new AbortController().signal)).toEqual(ids);
 expect(read.mock.calls.every(([query])=>query.idsOnly===true&&query.limit<=256)).toBe(true);
 expect(read).toHaveBeenCalledTimes(40);
});
test('select-all rejects a changed material frame, replacement library and cancellation without partial selection',async()=>{
 const read=vi.spyOn(practiceMaterialsRepository,'page');
 for(const next of [{incarnation:'one',revision:2},{incarnation:'replacement',revision:1}]){
  read.mockResolvedValueOnce({incarnation:'one',revision:1,total:300,items:[],ids:Array.from({length:256},(_,index)=>`id-${index}`)}).mockResolvedValueOnce({...next,total:300,items:[],ids:Array.from({length:44},(_,index)=>`id-${256+index}`)});
  await expect(collectPracticeExpressionIds({source:'books',languageTag:'en',query:''},new AbortController().signal)).rejects.toThrow('localFlow.meaningChanged');
 }
 const controller=new AbortController();controller.abort();const calls=read.mock.calls.length;
 await expect(collectPracticeExpressionIds({source:'personal',languageTag:'en',query:''},controller.signal)).rejects.toThrow();expect(read.mock.calls).toHaveLength(calls);
});
