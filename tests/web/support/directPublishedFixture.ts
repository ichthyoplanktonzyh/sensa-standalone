import {createSensaPortableLightweightPackage,readSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {sha256} from '@sensa/learning-kernel';
import type {SensaPortableLightweightPackage,SensaSenseSemanticSpec} from '@sensa/contracts/sensa';
import {preparePortablePackage} from '../../../apps/web/src/contentSupply/portable/portablePreparation';
import type {InstalledPackage,PortablePublicationAttestation} from '../../../apps/web/src/data/library/packageRecords';
import type {DirectLearningReference} from '../../../apps/web/src/learning/system/directLearningSource';
import {semanticLookupSpec} from './semanticLookupFixtures';

/** Real Portable compilation; publication discovery/transport is not exercised here. */
export function directPublishedFixture(versions?:{senseVersionId:string;bindingVersionId:string},semantic?:{senseId:string;bindingId:string;senseKey:string;semanticSpec:SensaSenseSemanticSpec}){
 const id=()=>crypto.randomUUID(),packageId=id(),at='2026-10-05T00:00:00Z',audio=new TextEncoder().encode('ID3 direct learning fixture');
 const manifest:SensaPortableLightweightPackage={format:'sensa-portable-lightweight-package-v2',
  metadata:{packageId,version:1,title:'Borrow fixture',description:'Direct learning fixture',createdAt:at,author:{name:'Fixture'},license:{name:'CC0'}},
  route:{targetLanguage:'en',supportLanguage:'zh-CN'},sense:{senseId:'borrow-fixture',meaning:semanticLookupSpec.coreMeaningFocus},targetExpression:{text:'borrow',expressionKind:'word',spokenForm:'borrow',acceptedForms:['borrowed']},
  resources:{experienceRecallCue:{text:'May needs an umbrella and asks a colleague for one.',senseFocus:'临时借用'},senseConfirmation:{text:'临时使用，之后归还。'},pronunciation:{surface:'borrow',audioMediaId:'pronunciation',method:'recording',source:'Fixture'},sceneBridge:{text:'暂时使用同事的物品。'},sceneRealization:{example:'May asked to borrow an umbrella.',translation:'May 想借一把伞。',targetStart:13,targetEnd:19},optional:{}},
  media:[{mediaId:'pronunciation',kind:'audio',mimeType:'audio/x-fixture',sha256:sha256(audio),sizeBytes:audio.byteLength}],
  semanticDeclaration:{contractVersion:'sensa-portable-semantic-declaration-v1',
   sense:{senseId:semantic?.senseId??id(),senseVersionId:versions?.senseVersionId??id(),senseKey:semantic?.senseKey??'published-borrow',versionNumber:1,semanticPolicyVersion:'fixture',semanticSpec:semantic?.semanticSpec??semanticLookupSpec},
   expression:{expressionId:id(),expressionVersionId:id(),versionNumber:1,expressionType:'word',structure:{}},
   binding:{senseExpressionBindingId:semantic?.bindingId??id(),bindingVersionId:versions?.bindingVersionId??id(),versionNumber:1,relation:'realizes',semanticCoverage:'exact',registerLabel:null,usageConstraints:[]}},
 };
 const bytes=createSensaPortableLightweightPackage(manifest,new Map([['pronunciation',audio]])),archive=readSensaPortableLightweightPackage(bytes);
 const publication:PortablePublicationAttestation={format:'sensa-portable-publication-attestation-v2',publisher:{namespace:'sensa.fixture',name:'Fixture'},book:{bookId:id(),bookKey:'direct-learning-fixture',bookVersionId:id(),versionNumber:1,title:'Fixture',description:''},contentRelease:{contentReleaseId:id(),versionNumber:1,schemaVersion:'sensa-portable-lightweight-package-v2'},route:manifest.route,publishedAt:at,changeSummary:'fixture',bookArchiveSha256:'c'.repeat(64),memberCount:1,member:{packageId,version:1}};
 const prepared=preparePortablePackage(bytes,archive,publication),canonical=prepared.canonical,key=prepared.installation.key;
 const pack:InstalledPackage={key,digest:canonical.archiveDigest,content:prepared.content,installedAt:at,portableOrigin:{format:'sensa-portable-installation-origin-v2',manifest:canonical.package,packageDigest:canonical.packageDigest,archiveDigest:canonical.archiveDigest,validatorVersion:'fixture',publications:[publication]}};
 const entry=pack.content.entries[0]!;
 const reference:DirectLearningReference={senseId:entry.senseId,senseVersionId:entry.senseVersionId,bindingId:entry.bindingId,bindingVersionId:entry.bindingVersionId,origin:{kind:'published_package',packageKey:key,packageDigest:canonical.packageDigest}};
 return {pack,reference,installation:prepared.installation};
}
