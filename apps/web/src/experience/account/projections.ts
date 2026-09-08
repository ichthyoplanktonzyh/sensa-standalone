import type {CatalogTarget,TargetView} from '@sensa/contracts/sensa';
import type {AccountReplica} from '../../data/replica/accountStore';
import type {LearningRecordView} from '../learningJourney/learningHistory';
import type {PrototypeLearningTargetView} from '../learningJourney/prototypeLearning';

/** Presentation only: every identity and learning fact comes from the account replica. */
export function presentTarget(candidate:CatalogTarget,view?:TargetView): Omit<PrototypeLearningTargetView,'targetId'> & {targetId:string} {
  return {targetId:view?.learningTarget?.learningTargetId??candidate.candidateId,expression:candidate.expression,meaning:candidate.meaning,expressionTypeLabel:'',partOfSpeech:'',example:'',sourceKind:candidate.source.kind==='book'?'book':candidate.source.kind==='personal_alignment'?'personal_semantic_world':'direct',sourceLabel:candidate.source.kind==='book'?'词书内容':candidate.source.kind==='personal_alignment'?'个人场景':'已发布内容',runtimeSenseId:candidate.senseId,personalExperienceGrounding:null,policy:'lightweight',lightweightReadiness:{status:view?.plan?.readiness??'preparing',label:'',detail:''}};
}
export function learningRecords(replica:AccountReplica):LearningRecordView[] {
  return Object.values(replica.runs).flatMap(run=>{
    const completion=run.completion,target=replica.targets[run.learningTargetId];
    if(!completion?.completedAt||!target)return [];
    return [{recordId:completion.completionId,targetId:run.learningTargetId,expression:target.candidate.expression,meaning:target.candidate.meaning,occurredAt:completion.completedAt,kind:run.purpose,label:run.purpose==='initial_learning'?'首次学习':run.purpose==='retention_review'?'复习':'重学',detail:completion.rating==='again'?'需要再次回想':'已确认的学习记录'}];
  }).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
}
