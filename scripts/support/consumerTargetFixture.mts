// Deterministic synthetic curriculum for isolated tests; never a production publisher.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {canonicalConsumerJson,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,sensaLightweightInitialMaterializationContentSchema} from '@sensa/contracts/sensa';
const id=(n:number)=>`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=(x:unknown)=>createHash('sha256').update(canonicalConsumerJson(x)).digest('hex');
const quote=(x:unknown)=>"'"+String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")+"'";
export const fixtureIds={candidate:id(1),book:id(2),blocked:id(3),invalid:id(4),reference:id(5)};
const resource=(role:string,payload:Record<string,unknown>,n:number)=>{
 const definition=SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND.materialRoles.find(x=>x.materialRoleKey===role)!;
 return {resourceKey:role+':0',materialRoleKey:role,ordinal:0,materialCandidateId:id(n),contentSchemaId:definition.contentSchemaId,contentSchemaVersion:'v1',contentPayload:payload,contentDigest:hash(payload),sourceArtifactIds:['synthetic-editorial-fixture-v1'],sourceMaterialCandidateIds:[],productionMethod:'published_reuse',producerProvider:'local-test-fixture',producerModel:null,producerPolicyId:definition.provisioningPolicyId,producerPolicyVersion:definition.provisioningPolicyVersion};
};
export async function fixtureSql(){
 let content:unknown={contentDemandKey:'lightweight-initial-content',definitionVersion:'v1',contentGenerationRequestId:id(40),resources:[resource('experience_recall_cue',{scene:'同事的方案有问题，你既要说明事实，也想照顾他的感受。',senseFocus:'真实表达意见，同时避免让人难堪。'},41),resource('target_expression',{surface:'tactful'},42),resource('sense_confirmation',{meaning:'表达真实意见时照顾对方感受，避免让对方难堪。'},43)]};
 let mediaSql='';
 if(process.env.SENSA_USE_GENERATED_TRIAL==='1'){
  content=JSON.parse(await readFile('content/data/consumer-generations/tactful-trial.json','utf8')).content;
  const bytes=await readFile('/tmp/sensa-m1b-tactful.mp3');const digest=createHash('sha256').update(bytes).digest('hex');
  const audio=resource('pronunciation',{audioUrl:'sensa-media:'+digest,phoneticNotation:null,accentLabel:'en-US'},44);
  (content as {resources:unknown[]}).resources.push(audio);
  mediaSql=`INSERT INTO sensa_consumer.published_media(digest,source_text_digest,mime_type,byte_size,producer) VALUES(${quote(digest)},${quote(createHash('sha256').update('tactful').digest('hex'))},'audio/mpeg',${bytes.length},'microsoft-edge-tts') ON CONFLICT DO NOTHING;`;
 }
 sensaLightweightInitialMaterializationContentSchema.parse(content);
 const commands=['BEGIN;',mediaSql];
 for(const n of [1,2]){
  commands.push(`INSERT INTO sensa.senses(sense_id,sense_key) VALUES(${quote(id(100+n))},${quote('m1b.synthetic.tactful.'+n)}) ON CONFLICT DO NOTHING;`);
  commands.push(`INSERT INTO sensa.sense_versions(sense_version_id,sense_id,version_number,version_origin,semantic_policy_version,semantic_spec,semantic_provenance,semantic_review_status) VALUES(${quote(id(110+n))},${quote(id(100+n))},1,'editorial','synthetic-v1',${quote({coreMeaningFocus:'表达真实意见时照顾对方感受，避免让对方难堪。'})},'{}','reviewed') ON CONFLICT DO NOTHING;`);
  commands.push(`INSERT INTO sensa.expressions(expression_id,expression_type,language_tag) VALUES(${quote(id(120+n))},'word','en') ON CONFLICT DO NOTHING;`);
  commands.push(`INSERT INTO sensa.expression_versions(expression_version_id,expression_id,version_number,surface_form,normalized_form,semantic_provenance) VALUES(${quote(id(130+n))},${quote(id(120+n))},1,'tactful','tactful','{}') ON CONFLICT DO NOTHING;`);
  commands.push(`INSERT INTO sensa.sense_expression_bindings(sense_expression_binding_id,sense_id,expression_id,relation) VALUES(${quote(id(140+n))},${quote(id(100+n))},${quote(id(120+n))},'realizes') ON CONFLICT DO NOTHING;`);
  commands.push(`INSERT INTO sensa.sense_expression_binding_versions(binding_version_id,sense_expression_binding_id,version_number,sense_version_id,expression_version_id,semantic_coverage,semantic_provenance,semantic_review_status) VALUES(${quote(id(150+n))},${quote(id(140+n))},1,${quote(id(110+n))},${quote(id(130+n))},'exact','{}','reviewed') ON CONFLICT DO NOTHING;`);
 }
 for(let n=1;n<=5;n++){
  const v=n===3?2:1;const payload=n===3?{}:content;
  const source={kind:n===2?'book':'catalog',id:n===2?'synthetic-book':'synthetic-catalog',version:'v1'};
  commands.push(`INSERT INTO sensa_consumer.catalog_candidates(id,sense_id,sense_version_id,binding_id,binding_version_id,expression,meaning,target_language,familiar_language,learner_locale,source,admission,content,content_digest,review_reference) VALUES(${[id(n),id(100+v),id(110+v),id(140+v),id(n===4?152:150+v),'tactful','表达真实意见时照顾对方感受，避免让对方难堪。','en','zh-CN','zh-CN',source,n===5?'reference_only':'available',payload,hash(payload),'synthetic-test-only-not-production-review'].map(quote).join(',')}) ON CONFLICT DO NOTHING;`);
 }
 commands.push('COMMIT;');return commands.join('\n');
}
if(process.argv.includes('--write')){await writeFile('/tmp/sensa-m1b-fixture.sql',await fixtureSql());console.log('Wrote isolated fixture SQL to /tmp/sensa-m1b-fixture.sql');}
