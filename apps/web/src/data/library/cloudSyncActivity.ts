export const accountLibrarySyncActivityEvent='sensa-account-library-sync-activity';
export type AccountLibrarySyncActivity=Readonly<{id:number;owner:Readonly<{subject:string;accountId:string}>;incarnation:string;preparing:boolean;phase:string;completed?:number;status:'running'|'ready'|'failed'|'cancelled';revision?:number;cancelling?:boolean}>;
let activity:AccountLibrarySyncActivity|undefined,activityController:{id:number;controller:AbortController}|undefined,activitySequence=0,lastActivityNotice=0;
const reportActivity=(value:AccountLibrarySyncActivity|undefined)=>{
 const changed=activity?.phase!==value?.phase||activity?.status!==value?.status||activity?.id!==value?.id;
 activity=value;const now=Date.now();
 if(changed||now-lastActivityNotice>=200){lastActivityNotice=now;window.dispatchEvent(new Event(accountLibrarySyncActivityEvent));}
};
export const readAccountLibrarySyncActivity=()=>activity;
export function observeAccountLibrarySyncActivity(listener:()=>void){window.addEventListener(accountLibrarySyncActivityEvent,listener);return()=>window.removeEventListener(accountLibrarySyncActivityEvent,listener);}
/** The displayed operation id prevents a late click from cancelling its successor. */
export function cancelAccountLibrarySync(id:number){
 if(activity?.id!==id||activity.status!=='running'||activityController?.id!==id)return;
 reportActivity({...activity,cancelling:true,phase:'cancelling'});activityController.controller.abort(Error('library_sync_cancelled'));
}

export function beginAccountLibrarySyncActivity(owner:AccountLibrarySyncActivity['owner'],incarnation:string,preparing:boolean,automatic=false){
 const id=++activitySequence,controller=new AbortController();
 // A routine freshness check can run after the preparation finished event.
 // It must not erase that result or replace a still-running cancel target.
 if(automatic&&activity?.preparing&&activity.owner.accountId===owner.accountId&&activity.owner.subject===owner.subject&&activity.incarnation===incarnation)return {id,controller};
 activityController={id,controller};reportActivity({id,owner:{...owner},incarnation,preparing,phase:preparing?'preparing':'sync',status:'running'});return {id,controller};
}
export function updateAccountLibrarySyncActivity(id:number,value:Partial<AccountLibrarySyncActivity>){if(activity?.id===id)reportActivity({...activity,...value});}
export function finishAccountLibrarySyncActivity(id:number){if(activity?.id===id&&activity.status==='running')reportActivity(undefined);if(activityController?.id===id)activityController=undefined;}
