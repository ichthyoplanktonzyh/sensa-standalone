import {decodeBackupValue} from './backupCodec';
import type {LibraryReplicaEntry} from './replication/libraryReplica';
import {buildDetailView} from '../../experience/personalMeaningJourney/projection';
import type {MeaningJourneyRecord} from '../../experience/personalMeaningJourney/store';
import type {IndexedRegistryRead} from '../../experience/personalMeaningJourney/registryRead';
import {parseStoredMedia} from './media';

export type ConflictPreviewField={label:'expression'|'meaning'|'context'|'note'|'examples'|'included'|'excluded'|'contrasts'|'questions'|'content';text:string};
export type ConflictPreview={title:string|null;removed:boolean;available:boolean;fields:ConflictPreviewField[];images:string[]};
export type ConflictComparison={id:string;base:ConflictPreview;local:ConflictPreview;remote:ConflictPreview};
export type CloudSyncComparison={records:ConflictComparison[];images:Record<string,string>};
type Branch=ReadonlyMap<string,LibraryReplicaEntry>;
const key=(table:string,id:string)=>JSON.stringify([table,id]);
const text=(value:unknown)=>typeof value==='string'?value:null;

/** Presentation only. Every version is projected from its own branch, never
 * from the current device's Registry. Selection still re-runs domain merge. */
export function buildCloudSyncComparison(ids:readonly string[],branches:{base:Branch;local:Branch;remote:Branch}):CloudSyncComparison{
 const images:Record<string,string>={},imageKeys=new Map<string,string>();
 const image=(url:string)=>{const found=imageKeys.get(url);if(found)return found;const id=`image-${imageKeys.size+1}`;imageKeys.set(url,id);images[id]=url;return id;};
 const preview=(id:string,branch:Branch):ConflictPreview=>{
  const row=branch.get(id),view:ConflictPreview={title:null,removed:!row,available:true,fields:[],images:[]};
  if(!row)return view;
  const read=(table:string,id:string)=>{const row=branch.get(key(table,id));return row?decodeBackupValue(row.value):undefined;};
  const field=(label:ConflictPreviewField['label'],value:unknown)=>{if(typeof value==='string'&&value.trim())view.fields.push({label,text:value});};
  try{
   const value=decodeBackupValue(row.value);
   if(row.table==='semanticMeanings'){
    const registry:IndexedRegistryRead=(kind,id)=>{const value=read('semanticRegistry',`${kind}:${id}`)?.value;if(!value)view.available=false;return value;};
    const detail=buildDetailView(value as MeaningJourneyRecord,registry);
    view.removed=detail.status==='deleted';
    const alignments=[...detail.directAlignments,...detail.focuses.flatMap(focus=>focus.alignment?[focus.alignment]:[])];
    const expressions=[...new Set(alignments.flatMap(alignment=>alignment.confirmedBindings.map(binding=>binding.surfaceForm)))];
    view.title=expressions.join(' · ')||detail.displayLabel;
    field('expression',expressions.join('\n'));
    for(const alignment of alignments){
     field('meaning',alignment.coreMeaningFocus);
     field('examples',alignment.semanticSpec?.prototypeScenes.map(scene=>[scene.summary,...scene.participantRoles,...scene.states,scene.directionOrCausality].filter(Boolean).join('\n')).join('\n\n'));
     field('included',alignment.semanticSpec?.includedCases.join('\n'));
     field('excluded',alignment.semanticSpec?.excludedCases.join('\n'));
     field('contrasts',alignment.semanticSpec?.neighborContrasts.map(item=>`${item.label}: ${item.distinction}`).join('\n'));
     field('questions',alignment.semanticSpec?.openQuestions.join('\n'));
    }
    for(const focus of detail.focuses){field('meaning',focus.statement);field('note',focus.distinguishingNotes.join('\n'));}
    field('note',detail.learnerIntentNote);
    for(const block of detail.materialBlocks){
     field('context',block.bodyText);
     const url=block.inlineDataUrl??(block.personalMediaObjectId?parseStoredMedia(read('media',block.personalMediaObjectId)).dataUrl:null);
     if(url){if(!url.startsWith('data:image/'))view.available=false;else view.images.push(image(url));}
    }
    view.available=view.available&&(view.removed||view.fields.length>0||view.images.length>0);
   }else if(row.table==='drafts'){
    field('content',value?.text);view.available=view.fields.length>0;
   }else if(row.table==='meanings'){
    view.title=text(value?.expression)??text(value?.title);field('meaning',value?.meaning??value?.text);view.available=view.fields.length>0;
   }else if(row.table==='semanticRegistry'){
    const fact=value?.value;view.title=text(fact?.surfaceForm);
    field('expression',fact?.surfaceForm);field('meaning',fact?.semanticSpec?.coreMeaningFocus);
    // A Registry conflict may concern language, bindings or another semantic
    // boundary, not just this caption. A partial caption is not a full choice.
    view.available=false;
   }else if(row.table==='curriculumEnrollments'){
    view.title=text(value?.source?.title);field('content',view.title);view.available=false;
   }else{
    // Do not replace an unavailable user preview with internal IDs or a JSON
    // dump, or pretend that an opaque version can be safely chosen.
    view.available=false;
   }
  }catch{view.available=false;}
  return view;
 };
 return {records:ids.map(id=>({id,base:preview(id,branches.base),local:preview(id,branches.local),remote:preview(id,branches.remote)})),images};
}
