/** Private Protocol fixtures read live admitted state explicitly; a command
 * receipt itself is immutable bounded metadata, never a full Run snapshot. */
import * as commands from '../../../apps/web/src/data/library/learning';
import {readLibrary} from '../../../apps/web/src/data/library/store';
import type {LocalLearningRun} from '../../../apps/web/src/learning/runtime/localProtocol';

const liveRun=async(receipt:{id:string;revision:number})=>readLibrary(async tx=>{
 const run=await tx.get<LocalLearningRun>('learningRuns',receipt.id);
 if(!run||run.revision<receipt.revision)throw new Error('Fixture Run is not admitted');
 return run;
});
export const startLearning=async(...args:Parameters<typeof commands.startLearning>)=>liveRun(await commands.startLearning(...args));
export const actLearning=async(...args:Parameters<typeof commands.actLearning>)=>liveRun(await commands.actLearning(...args));
export const continueLearning=async(...args:Parameters<typeof commands.continueLearning>)=>liveRun(await commands.continueLearning(...args));
