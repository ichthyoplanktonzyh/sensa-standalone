import {test} from 'vitest';
import assert from 'node:assert/strict';

import {decodeBackupValue,encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';
import {mergeLibraryReplicas,planLibraryReplicaApply,replicaEntryId} from '../../../apps/web/src/data/library/replication/libraryReplica.ts';
import {assertPersonalSemanticWorldState,assertPersonalSemanticWorldTransition,PersonalSemanticWorldInvariantError} from '../../../apps/web/src/experience/personalMeaningJourney/authority.ts';
import {emptyJourneyState} from '../../../apps/web/src/experience/personalMeaningJourney/store.ts';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository.ts';

test("personal-semantic-world-merge", async () => {

type Entry={table:any;key:string;value:unknown};
const PSW='sensa-personal-semantic-world-v3';
const at=(second:number)=>`2026-09-21T09:00:${String(second).padStart(2,'0')}.000Z`;
let nextId=1;
const id=()=>`00000000-0000-4000-8000-${String(nextId++).padStart(12,'0')}`;
const entry=(table:string,key:string,value:unknown):Entry=>({table,key,value:encodeBackupValue(value)});
const merge=(base:Entry[],local:Entry[],remote:Entry[])=>mergeLibraryReplicas({base:base as any,local:local as any,remote:remote as any});

const meaningId=id(),anchorId=id(),anchorRevisionId=id(),meaningRevisionId=id();
const baseMeaning={
 personalMeaning:{contractVersion:PSW,personalMeaningId:meaningId,learnerUserId:id(),currentRevision:1,lifecycleRevision:1,status:'active',createdAt:at(0),updatedAt:at(0),deletedAt:null,deletedByOperationId:null},
 personalMeaningRevisions:[{contractVersion:PSW,personalMeaningRevisionId:meaningRevisionId,personalMeaningId:meaningId,revision:1,displayLabel:'raincoat',learnerIntentNote:null,provenance:{kind:'learner_authored',sourceReferenceIds:[anchorId],createdByOperationId:id()},createdAt:at(0)}],
 personalSemanticAnchors:[{contractVersion:PSW,personalSemanticAnchorId:anchorId,personalMeaningId:meaningId,currentRevision:1,lifecycleRevision:1,status:'active',createdAt:at(0),updatedAt:at(0),deletedAt:null,deletedByOperationId:null}],
 personalSemanticAnchorRevisions:[{contractVersion:PSW,personalSemanticAnchorRevisionId:anchorRevisionId,personalSemanticAnchorId:anchorId,revision:1,anchorKind:'text',languageTag:'en',bodyText:'I wore my raincoat.',personalMediaObjectId:null,structuredPayload:{},provenance:{kind:'learner_authored',sourceReferenceIds:[anchorId],createdByOperationId:id()},createdAt:at(0)}],
 personalExpressionAnchors:[],personalExpressionAnchorRevisions:[],focuses:[],focusRevisions:[],focusAcceptances:[],constructions:[],constructionTurns:[],proposals:[],proposalVersions:[],senseConfirmations:[],semanticAcceptances:[],alignments:[],alignmentEvents:[],bindingConfirmations:[],
 mockState:{focusAspectLabels:{},startingPoint:null},
};
const baseRow=entry('semanticMeanings',meaningId,baseMeaning);
const baseState={...emptyJourneyState(),meanings:[baseMeaning]} as any;
assert.doesNotThrow(()=>assertPersonalSemanticWorldState(baseState));
const repository=new MemoryJourneyRepository(),empty=await repository.load();
await repository.commit({before:empty,after:baseState});

const focusId=id(),focusRevisionId=id(),focusOperation=id();
const localAddition=structuredClone(baseMeaning);
localAddition.focuses.push({contractVersion:PSW,meaningFocusId:focusId,personalMeaningId:meaningId,splitFromMeaningFocusId:null,currentRevision:1,acceptedRevision:1,lifecycleRevision:1,status:'active',createdAt:at(1),updatedAt:at(1),deletedAt:null,deletedByOperationId:null} as never);
localAddition.focusRevisions.push({contractVersion:PSW,meaningFocusRevisionId:focusRevisionId,meaningFocusId:focusId,revision:1,statement:'staying dry',distinguishingNotes:[],provenance:{kind:'learner_authored',sourceReferenceIds:[meaningId],createdByOperationId:focusOperation},createdAt:at(1)} as never);
localAddition.focusAcceptances.push({contractVersion:PSW,meaningFocusAcceptanceId:id(),meaningFocusId:focusId,meaningFocusRevisionId:focusRevisionId,operationId:focusOperation,acceptedAt:at(1)} as never);
localAddition.mockState.focusAspectLabels[focusId]='weather';
const expressionId=id(),expressionRevisionId=id();
const remoteAddition=structuredClone(baseMeaning);
remoteAddition.personalExpressionAnchors.push({contractVersion:PSW,personalExpressionAnchorId:expressionId,personalMeaningId:meaningId,currentRevision:1,lifecycleRevision:1,status:'active',createdAt:at(2),updatedAt:at(2),deletedAt:null,deletedByOperationId:null} as never);
remoteAddition.personalExpressionAnchorRevisions.push({contractVersion:PSW,personalExpressionAnchorRevisionId:expressionRevisionId,personalExpressionAnchorId:expressionId,revision:1,expressionType:'word',languageTag:'en',surfaceForm:'raincoat',normalizedForm:'raincoat',contextAnchorRevisionId:anchorRevisionId,occurrence:{kind:'text_span',start:10,end:18},provenanceKind:'learner_authored',verificationStatus:'learner_confirmed',provenance:{kind:'learner_authored',sourceReferenceIds:[anchorId],createdByOperationId:id()},createdAt:at(2)} as never);
const independent=merge([baseRow],[entry('semanticMeanings',meaningId,localAddition)],[entry('semanticMeanings',meaningId,remoteAddition)]);
assert.deepEqual(independent.conflicts,[],'independent facts inside one Personal Meaning must converge');
const independentMeaning=decodeBackupValue(independent.entries[0]!.value) as any;
assert.equal(independentMeaning.focuses.length,1);assert.equal(independentMeaning.personalExpressionAnchors.length,1);assert.equal(independentMeaning.mockState.focusAspectLabels[focusId],'weather');
const localState={...baseState,meanings:[localAddition]};
assert.doesNotThrow(()=>assertPersonalSemanticWorldTransition(baseState,localState),'the local authority must admit an independent append');

const localRevision=structuredClone(baseMeaning),remoteRevision=structuredClone(baseMeaning);
for(const [branch,revisionId,label,second] of [[localRevision,id(),'local',3],[remoteRevision,id(),'remote',4]] as const){
 branch.personalMeaning.currentRevision=2;branch.personalMeaning.updatedAt=at(second);
 branch.personalMeaningRevisions.push({...branch.personalMeaningRevisions[0],personalMeaningRevisionId:revisionId,revision:2,displayLabel:label,createdAt:at(second)} as never);
}
const revisionFork=merge([baseRow],[entry('semanticMeanings',meaningId,localRevision)],[entry('semanticMeanings',meaningId,remoteRevision)]);
assert.deepEqual(revisionFork.conflicts,[replicaEntryId(baseRow as any)],'the same revision number with different facts must remain a conflict');

const deleteOperation=id(),deleted=structuredClone(baseMeaning);
Object.assign(deleted.personalSemanticAnchors[0],{lifecycleRevision:2,status:'deleted',updatedAt:at(5),deletedAt:at(5),deletedByOperationId:deleteOperation});
const tombstone=merge([baseRow],[entry('semanticMeanings',meaningId,deleted)],[baseRow]);
assert.deepEqual(tombstone.conflicts,[]);
assert.equal((decodeBackupValue(tombstone.entries[0]!.value) as any).personalSemanticAnchors[0].status,'deleted','a tombstone must beat an unchanged base without removing the aggregate');

const edited=structuredClone(baseMeaning);edited.personalSemanticAnchors[0].currentRevision=2;edited.personalSemanticAnchors[0].updatedAt=at(6);edited.personalSemanticAnchorRevisions.push({...edited.personalSemanticAnchorRevisions[0],personalSemanticAnchorRevisionId:id(),revision:2,bodyText:'I kept dry in my raincoat.',createdAt:at(6)} as never);
assert.deepEqual(merge([baseRow],[entry('semanticMeanings',meaningId,deleted)],[entry('semanticMeanings',meaningId,edited)]).conflicts,[replicaEntryId(baseRow as any)],'delete versus a concurrent edit must not guess');

const deletedElsewhere=structuredClone(deleted);deletedElsewhere.personalSemanticAnchors[0].deletedAt=at(7);deletedElsewhere.personalSemanticAnchors[0].updatedAt=at(7);deletedElsewhere.personalSemanticAnchors[0].deletedByOperationId=id();
const duplicateDelete=merge([baseRow],[entry('semanticMeanings',meaningId,deleted)],[entry('semanticMeanings',meaningId,deletedElsewhere)]);
assert.deepEqual(duplicateDelete.conflicts,[],'equivalent concurrent tombstones converge deterministically');
assert.equal((decodeBackupValue(duplicateDelete.entries[0]!.value) as any).personalSemanticAnchors[0].deletedAt,at(7));

const resurrected=structuredClone(deleted);Object.assign(resurrected.personalSemanticAnchors[0],baseMeaning.personalSemanticAnchors[0]);
assert.deepEqual(merge([entry('semanticMeanings',meaningId,deleted)],[entry('semanticMeanings',meaningId,resurrected)],[entry('semanticMeanings',meaningId,deleted)]).conflicts,[replicaEntryId(baseRow as any)],'a tombstone cannot be changed back to active');

const malformedDelete=structuredClone(baseMeaning);Object.assign(malformedDelete.personalSemanticAnchors[0],{status:'deleted',updatedAt:at(8),deletedAt:at(8),deletedByOperationId:id()});
assert.deepEqual(merge([baseRow],[entry('semanticMeanings',meaningId,malformedDelete)],[baseRow]).conflicts,[replicaEntryId(baseRow as any)],'a tombstone must advance its lifecycle revision');

const rewrittenMeaning=structuredClone(baseMeaning);rewrittenMeaning.personalMeaningRevisions[0].displayLabel='rewritten history';
assert.throws(()=>assertPersonalSemanticWorldTransition(baseState,{...baseState,meanings:[rewrittenMeaning]} as any),PersonalSemanticWorldInvariantError,'local commits cannot rewrite an immutable revision');
await assert.rejects(repository.commit({before:baseState,after:{...baseState,meanings:[rewrittenMeaning]} as any}),PersonalSemanticWorldInvariantError,'the repository must enforce the authority seam');
assert.equal((await repository.load()).meanings[0]!.personalMeaningRevisions[0]!.displayLabel,'raincoat','a rejected transition must leave storage untouched');
assert.throws(()=>assertPersonalSemanticWorldTransition({...baseState,meanings:[deleted]} as any,baseState),PersonalSemanticWorldInvariantError,'local commits cannot resurrect a tombstone');

const physicalDelete=merge([baseRow],[],[baseRow]);
assert.deepEqual(physicalDelete.conflicts,[replicaEntryId(baseRow as any)],'a missing durable row is not a Personal Semantic World deletion');
assert.throws(()=>planLibraryReplicaApply([baseRow] as any,[]),/library_sync_tombstone_required/u);

const senseId=id(),senseVersionOne=id(),senseVersionLocal=id(),senseVersionRemote=id();
const registry=(kind:string,key:string,value:unknown,ordinal=0)=>entry('semanticRegistry',`${kind}:${key}`,{kind,ordinal,value});
const senseHead=registry('senses',senseId,{contractVersion:'sensa-semantic-registry-v1',senseId,senseKey:'raincoat',currentSenseVersionId:senseVersionOne,currentVersionNumber:1,createdAt:at(0)});
const senseV1=registry('senseVersions',senseVersionOne,{contractVersion:'sensa-semantic-registry-v1',senseVersionId:senseVersionOne,senseId,versionNumber:1});
const localHead=registry('senses',senseId,{contractVersion:'sensa-semantic-registry-v1',senseId,senseKey:'raincoat',currentSenseVersionId:senseVersionLocal,currentVersionNumber:2,createdAt:at(0)});
const remoteHead=registry('senses',senseId,{contractVersion:'sensa-semantic-registry-v1',senseId,senseKey:'raincoat',currentSenseVersionId:senseVersionRemote,currentVersionNumber:2,createdAt:at(0)});
const localV2=registry('senseVersions',senseVersionLocal,{contractVersion:'sensa-semantic-registry-v1',senseVersionId:senseVersionLocal,senseId,versionNumber:2});
const remoteV2=registry('senseVersions',senseVersionRemote,{contractVersion:'sensa-semantic-registry-v1',senseVersionId:senseVersionRemote,senseId,versionNumber:2});
const registryFork=merge([senseHead,senseV1],[localHead,senseV1,localV2],[remoteHead,senseV1,remoteV2]);
assert(registryFork.conflicts.includes(replicaEntryId(senseHead as any)));
assert(registryFork.conflicts.includes(replicaEntryId(localV2 as any))&&registryFork.conflicts.includes(replicaEntryId(remoteV2 as any)),'two identities cannot occupy the same Registry revision slot');

const rewrittenV1=registry('senseVersions',senseVersionOne,{contractVersion:'sensa-semantic-registry-v1',senseVersionId:senseVersionOne,senseId,versionNumber:1,definition:'rewritten'});
assert.deepEqual(merge([senseHead,senseV1],[senseHead,rewrittenV1],[senseHead,senseV1]).conflicts,[replicaEntryId(senseV1 as any)],'an existing Registry version is immutable');

console.log('PASS: one Personal Semantic World authority validates local commits and replicas, preserves immutable revisions, converges valid tombstones, blocks resurrection and rejects Registry mutations or revision collisions.');

});
