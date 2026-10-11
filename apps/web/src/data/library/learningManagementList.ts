import {learningSupportMeaning,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import type {LearningManagementListItem} from '../../learning/system/learningReadModels';

/** Rebuildable list presentation. No media, material, Run or history crosses the page boundary. */
export function learningManagementListRecord(target:LocalLearningTarget){
 return {id:target.id,expression:target.expression,targetLanguageTag:target.targetLanguageTag,
  started:!!target.startedAt,completed:!!target.completedAt,declared:target.planningOverrides.some(row=>row.kind==='declared_mastery'),
  dueAt:target.relearnAt??target.memory?.dueAt.toISOString()??null,relearning:!!target.relearnAt,
  policy:target.committedPolicy?.profileId??target.policyAssignment.profileId,
  members:target.curriculumMemberships.map((member,index)=>({id:member.id??`${target.id}:${index}`,status:member.status,context:member.languageContext,
   meaning:learningSupportMeaning(member.material.content.resources,member.languageContext.supportLanguageTag),
   sourceKind:member.sourceKind,enrollmentId:typeof member.provenance.curriculumEnrollmentId==='string'?member.provenance.curriculumEnrollmentId:null,
   packageKey:member.packageKey,assurancePackageKey:member.assurancePackageKey,validated:member.material.snapshot.validationStatus==='validated'}))};
}
export function learningManagementListItem(record:ReturnType<typeof learningManagementListRecord>,context:SensaFormalPinnedLanguageContext,clock:number,
 eligibility:Readonly<Record<string,{introduce:boolean;ongoing:boolean}>>,enrollments:ReadonlyMap<string,{title:string|null;paused:boolean}>,available:ReadonlySet<string>,policies:readonly string[]):LearningManagementListItem|null{
 const members=record.members.filter(member=>member.context.languageRouteId===context.languageRouteId&&member.context.targetLanguageTag===context.targetLanguageTag&&member.context.supportLanguageTag===context.supportLanguageTag);
 if(!members.length)return null;
 const active=(member:typeof members[number])=>!!member.id&&!!eligibility[member.id]?.[record.started?'ongoing':'introduce'];
 const ready=(member:typeof members[number])=>active(member)&&member.validated&&policies.includes(record.policy)&&(record.policy==='lightweight'||!!member.packageKey&&available.has(member.packageKey)&&!!member.assurancePackageKey);
 const member=[...members].reverse().find(ready)??[...members].reverse().find(active)??[...members].reverse().find(member=>member.status!=='superseded')??members[members.length-1]!;
 const planningActive=members.some(active),paused=!planningActive&&members.some(member=>!!member.enrollmentId&&enrollments.get(member.enrollmentId)?.paused);
 const due=!!record.dueAt&&Date.parse(record.dueAt)<=clock;
 const state=paused?'paused':record.declared?'declared':!planningActive?'not_planned':record.relearning?'relearning':record.completed&&due?'review-due':record.completed?'completed':record.started?'committed':ready(member)?'ready':'blocked';
 return {targetId:record.id,expression:record.expression,meaning:member.meaning,targetLanguageTag:record.targetLanguageTag,supportLanguageTag:context.supportLanguageTag,
  sourceKind:member.sourceKind,sourceTitle:member.enrollmentId?enrollments.get(member.enrollmentId)?.title??null:null,started:record.started,state,
  group:paused?'paused':!record.declared&&ready(member)&&due?'due':!record.declared&&ready(member)&&!record.completed?'new':record.completed||record.declared?'complete':record.started?'active':'other',nextReviewAt:record.dueAt};
}
