import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {learningSystem} from '../../learning/system';
import {contentSupplySystem} from '../../contentSupply/system';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {resolveLearningQueue,selectInterleavedLearningTarget,type InterleavedLearningRetry} from './learningQueue';

/** A declaration removes eligibility; choose the next target from fresh facts.
 * No completion, rating or schedule is synthesized for the skipped target. */
export async function declareKnownAndContinue(targetId:string,context:SensaFormalPinnedLanguageContext,dailyLimit:number|undefined,retries:readonly InterleavedLearningRetry[],at=new Date().toISOString()){
 await learningSystem.execute({kind:'set_declared_mastery',operationId:crypto.randomUUID(),targetId,active:true,at});
 const [snapshot,supply]=await Promise.all([learningSystem.read({kind:'overview'}),contentSupplySystem.read({kind:'workspace'})]);
 const readiness=Object.fromEntries(snapshot.targets.map(target=>{const membership=localCurriculumMembershipForContext(target,context);return [target.id,inspectLocalTargetReadiness(target,membership,membership?.packageKey?supply.packages.find(p=>p.key===membership.packageKey):undefined).status];})) as Record<string,'ready'|'blocked'>;
 const queue=resolveLearningQueue({targets:snapshot.targets,languageRouteId:context.languageRouteId,readiness,clock:Date.parse(at),dailyLimit});
 const remainingRetries=retries.filter(r=>r.id!==targetId);
 const next=selectInterleavedLearningTarget({...queue,currentRunTargetIds:[],retries:remainingRetries});
 const nextRun=next&&dailyLimit!==undefined?await learningSystem.execute({kind:'start',operationId:crypto.randomUUID(),targetId:next.id,languageContext:context,dailyLimit,at}):null;
 return {nextRun,remainingRetries};
}
