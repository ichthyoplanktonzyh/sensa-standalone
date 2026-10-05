import type {LocalCurriculumEnrollment} from '../../data/library/curriculumEnrollments';
import type {SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';

/** Eligibility belongs to source × purpose, not to the shared Target status. */
export type CurriculumPlanningSource=Readonly<{
 id?:string;status?:'active'|'superseded';packageKey:string|null;
 provenance?:Readonly<Record<string,unknown>>;
 material?:Readonly<{snapshot:Readonly<{validationStatus?:string;provenance?:Readonly<Record<string,unknown>>}>}>;
 languageContext:Readonly<{languageRouteId:string;targetLanguageTag?:string;supportLanguageTag?:string}>;
}>;
export type CurriculumSourceEligibility=Readonly<{introduce:boolean;ongoing:boolean}>;
const selectedMembers=new WeakMap<object,ReadonlySet<string>>();
const memberKey=(key:string|null,sense:unknown,binding:unknown)=>JSON.stringify([key,sense,binding]);
export function curriculumSourceEligibility(source:CurriculumPlanningSource,enrollment:LocalCurriculumEnrollment|undefined,started:boolean):Readonly<{introduce:boolean;ongoing:boolean}>{
 if(enrollment?.source.kind!=='published_book'){
  const active=source.status!=='superseded'&&enrollment?.status!=='superseded'&&(!source.provenance?.curriculumEnrollmentId||!!enrollment);
  return {introduce:active,ongoing:active};
 }
 const plan=enrollment.bookPlan,mode=plan?.mode??'active';
 if(enrollment.status==='superseded'||mode==='paused')return {introduce:false,ongoing:false};
 const sameVersion=source.provenance?.publicationArchiveSha256===enrollment.source.publicationArchiveSha256;
 const pins=source.material?.snapshot.provenance??source.provenance;
 let selected=!plan||plan.range.selection.kind==='all';
 if(plan&&!selected){
  let members=selectedMembers.get(plan.range);
  if(!members){members=new Set(plan.range.members.map(member=>memberKey(member.packageKey,member.senseVersionId,member.bindingVersionId)));selectedMembers.set(plan.range,members);}
  selected=members.has(memberKey(source.packageKey,pins?.senseVersionId,pins?.bindingVersionId));
 }
 return {introduce:mode==='active'&&sameVersion&&selected&&source.status!=='superseded',ongoing:started};
}

export function planningMembershipForContext<Member extends CurriculumPlanningSource>(
 target:Readonly<{startedAt:string|null;curriculumMemberships:readonly Member[]}>,
 context:SensaFormalPinnedLanguageContext,enrollments:ReadonlyMap<string,LocalCurriculumEnrollment>,ready:(member:Member)=>boolean=()=>true,compiled?:Readonly<Record<string,CurriculumSourceEligibility>>,
):Member|undefined{
 return [...target.curriculumMemberships].reverse().find(member=>{
  if(member.languageContext.languageRouteId!==context.languageRouteId||member.languageContext.targetLanguageTag!==context.targetLanguageTag||member.languageContext.supportLanguageTag!==context.supportLanguageTag)return false;
  const id=member.provenance?.curriculumEnrollmentId;
  const eligibility=member.id&&compiled?.[member.id]||curriculumSourceEligibility(member,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt);
  return (target.startedAt?eligibility.ongoing:eligibility.introduce)&&ready(member);
 });
}
