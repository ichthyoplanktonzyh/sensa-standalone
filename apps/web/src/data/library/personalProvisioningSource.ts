import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import type {PersonalMeaningLearningReference,PersonalMeaningLearningSource} from '../../contentSupply/provisioning/contracts';
import {buildPersonalMeaningLearningSources,hydratePersonalLearningImages} from '../../experience/personalMeaningJourney/learningSource';
import {parseStoredMedia} from './media';
import {indexRegistry} from '../../experience/personalMeaningJourney/registryRead';
import type {MeaningJourneyRecord} from '../../experience/personalMeaningJourney/store';
import {readMeaningRegistry} from '../../experience/personalMeaningJourney/worldRepository';
import type {LibraryTransaction} from './store';

/** Resolve one accepted Alignment inside the writer snapshot. A caller's IDs
 * do not authorize replacement meaning, expression or private Context bytes. */
export async function readPersonalProvisioningSource(tx:Pick<LibraryTransaction,'get'>,reference:PersonalMeaningLearningReference,contextPin?:readonly string[]):Promise<PersonalMeaningLearningSource>{
 const record=await tx.get<MeaningJourneyRecord>('semanticMeanings',reference.personalMeaningId);
 if(!record||record.personalMeaning.personalMeaningId!==reference.personalMeaningId)throw new Error('localFlow.meaningChanged');
 const {registry}=await readMeaningRegistry(tx,record);
 const candidates=await hydratePersonalLearningImages(record,buildPersonalMeaningLearningSources(record,indexRegistry(registry),reference.personalMeaningAlignmentId,contextPin),async mediaId=>{
  const media=parseStoredMedia(await tx.get('media',mediaId));if(media.mediaId!==mediaId)throw new Error('localFlow.meaningChanged');
  return {id:mediaId,name:'personal-context-image',dataUrl:media.dataUrl};
 });
 const accepted=candidates.find(candidate=>canonicalConsumerJson(candidate.reference)===canonicalConsumerJson(reference));
 if(!accepted)throw new Error('localFlow.meaningChanged');
 return accepted;
}
export async function assertPersonalProvisioningSource(tx:LibraryTransaction,source:PersonalMeaningLearningSource,contextPin?:readonly string[]):Promise<void>{
 const record=await tx.get<MeaningJourneyRecord>('semanticMeanings',source.reference.personalMeaningId);
 if(record?.personalMeaning.status!=='active')throw new Error('localFlow.meaningChanged');
 const accepted=await readPersonalProvisioningSource(tx,source.reference,contextPin);
 if(canonicalConsumerJson(accepted)!==canonicalConsumerJson(source))throw new Error('localFlow.meaningChanged');
}
