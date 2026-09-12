import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';
import {defaultSensaLanguageProfile,type SensaLanguageProfile} from '@sensa/contracts/sensa';
import {observeLibrary} from '../../data/library/store';
import {languageProfileSnapshot,addTargetLanguage,removeTargetLanguage,setActiveTargetLanguage} from '../../data/library/language';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';

/**
 * The learner's standing language choice, shared by every surface that has to
 * name a language.
 *
 * Reads fall back to the shipped pair while nothing is loaded, so a surface that
 * renders before the library answers shows the default instead of an empty
 * picker. Writes go through the library command log like every other learner
 * choice.
 */
export function useLanguageProfile(){
 useTranslation();
 const [state,setState]=useState<{profile:SensaLanguageProfile;saved:boolean}|null>(null);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true);
 const refresh=async()=>{const next=await languageProfileSnapshot();if(mounted.current)setState(next);};
 useEffect(()=>{
  mounted.current=true;
  const read=()=>void refresh().catch(()=>setNotice(localFlowText('languageReadFailed')));
  read();
  const stop=observeLibrary(read);
  return()=>{mounted.current=false;stop();};
 },[]);
 /** Every write refreshes from storage instead of trusting the returned value:
  * two tabs can change the profile and only the library knows which won. */
 const perform=async<T,>(work:()=>Promise<T>)=>{setBusy(true);setNotice('');try{const result=await work();await refresh();return result;}catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('languageReadFailed'));return null;}finally{setBusy(false);}};
 const profile=state?.profile??defaultSensaLanguageProfile;
 return {
  profile,saved:state?.saved??false,busy,notice:localFlowNotice(notice),refresh,
  addTarget:(tag:string)=>perform(()=>addTargetLanguage(crypto.randomUUID(),tag)),
  removeTarget:(tag:string)=>perform(()=>removeTargetLanguage(crypto.randomUUID(),tag)),
  setActiveTarget:(tag:string)=>perform(()=>setActiveTargetLanguage(crypto.randomUUID(),tag)),
 };
}
