import {readMeaningContexts} from '../../experience/personalMeaningJourney/contextRecords';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import type {PersonalMeaningLearningReference,PersonalMeaningLearningSource} from '../../contentSupply/provisioning/contracts';
import {buildPersonalMeaningLearningSources,hydratePersonalLearningImages,personalMeaningPinnedRecord,resolvePinnedPersonalMeaningLearningSource} from '../../experience/personalMeaningJourney/learningSource';
import {parseStoredMedia} from './media';
import {indexRegistry} from '../../experience/personalMeaningJourney/registryRead';
import type {MeaningJourneyRecord} from '../../experience/personalMeaningJourney/store';
import {readMeaningRegistry} from '../../experience/personalMeaningJourney/worldRepository';
import type {LibraryTransaction} from './store';

/** Resolve one accepted Alignment inside the writer snapshot. A caller's IDs
 * do not authorize replacement meaning, expression or private Context bytes. */
async function resolvePersonalProvisioningSource(tx:Pick<LibraryTransaction,'get'>,reference:PersonalMeaningLearningReference,contextPin?:readonly string[],historical=false){
 const current=await readMeaningContexts(tx,reference.personalMeaningId);
 if(!current||current.personalMeaning.personalMeaningId!==reference.personalMeaningId)throw new Error('localFlow.meaningChanged');
 const record=historical?personalMeaningPinnedRecord(current,reference,contextPin):current;
 if(!record)throw new Error('localFlow.meaningChanged');
 const {registry}=await readMeaningRegistry(tx,record);
 const pinned=historical?resolvePinnedPersonalMeaningLearningSource(record,indexRegistry(registry),reference,contextPin):null;
 const sources=historical?(pinned?[pinned]:[]):buildPersonalMeaningLearningSources(record,indexRegistry(registry),reference.personalMeaningAlignmentId,contextPin);
 const accepted=sources.find(candidate=>canonicalConsumerJson(candidate.reference)===canonicalConsumerJson(reference));
 if(!accepted)throw new Error('localFlow.meaningChanged');
 return {record,sources,accepted};
}
/** A library row needs the accepted expression and meaning, without private media. */
export async function readPersonalProvisioningPresentation(tx:Pick<LibraryTransaction,'get'>,reference:PersonalMeaningLearningReference,contextPin?:readonly string[]){
 const {accepted}=await resolvePersonalProvisioningSource(tx,reference,contextPin,true);
 return {expression:accepted.expression.surfaceForm,meaning:accepted.semanticSpec.coreMeaningFocus};
}
export async function readPersonalProvisioningSource(tx:Pick<LibraryTransaction,'get'>,reference:PersonalMeaningLearningReference,contextPin?:readonly string[],historical=false):Promise<PersonalMeaningLearningSource>{
 const {record,sources}=await resolvePersonalProvisioningSource(tx,reference,contextPin,historical);
 const candidates=await hydratePersonalLearningImages(record,sources,async mediaId=>{
  const media=parseStoredMedia(await tx.get('media',mediaId));if(media.mediaId!==mediaId)throw new Error('localFlow.meaningChanged');
  return {id:mediaId,name:'personal-context-image',dataUrl:media.dataUrl};
 });
 const accepted=candidates.find(candidate=>canonicalConsumerJson(candidate.reference)===canonicalConsumerJson(reference));
 if(!accepted)throw new Error('localFlow.meaningChanged');
 return accepted;
}
export async function assertPersonalProvisioningSource(tx:LibraryTransaction,source:PersonalMeaningLearningSource,contextPin?:readonly string[],historical=false):Promise<void>{
 const record=await readMeaningContexts(tx,source.reference.personalMeaningId);
 if(!record||(!historical&&record.personalMeaning.status!=='active'))throw new Error('localFlow.meaningChanged');
 const accepted=await readPersonalProvisioningSource(tx,source.reference,contextPin,historical);
 if(canonicalConsumerJson(accepted)!==canonicalConsumerJson(source))throw new Error('localFlow.meaningChanged');
}
