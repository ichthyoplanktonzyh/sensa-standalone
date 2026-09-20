import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {setLocalDeclaredMastery,readLearningOverview,startLearning} from '../../data/library/learning';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {resolveLearningQueue,selectInterleavedLearningTarget,type InterleavedLearningRetry} from './learningQueue';

/** A declaration removes eligibility; choose the next target from fresh facts.
 * No completion, rating or schedule is synthesized for the skipped target. */
export async function declareKnownAndContinue(targetId:string,context:SensaFormalPinnedLanguageContext,dailyLimit:number|undefined,retries:readonly InterleavedLearningRetry[],at=new Date().toISOString()){
 await setLocalDeclaredMastery(crypto.randomUUID(),targetId,true,at);
 const snapshot=await readLearningOverview();
 const readiness=Object.fromEntries(snapshot.targets.map(target=>{const membership=localCurriculumMembershipForContext(target,context);return [target.id,inspectLocalTargetReadiness(target,membership,membership?.packageKey?snapshot.packages.find(p=>p.key===membership.packageKey):undefined).status];})) as Record<string,'ready'|'blocked'>;
 const queue=resolveLearningQueue({targets:snapshot.targets,languageRouteId:context.languageRouteId,readiness,clock:Date.parse(at),dailyLimit});
 const remainingRetries=retries.filter(r=>r.id!==targetId);
 const next=selectInterleavedLearningTarget({...queue,currentRunTargetIds:[],retries:remainingRetries});
 const nextRun=next&&dailyLimit!==undefined?await startLearning(crypto.randomUUID(),next.id,context,dailyLimit,at):null;
 return {nextRun,remainingRetries};
}
