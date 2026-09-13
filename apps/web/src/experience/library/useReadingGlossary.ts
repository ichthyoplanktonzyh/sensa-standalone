import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';
import type {SensaReadingGlossary} from '@sensa/contracts/sensa';
import {observeLibrary} from '../../data/library/store';
import {readingGlossarySnapshot,setReadingGlossaryEntry,removeReadingGlossaryEntry} from '../../data/library/glossary';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';

/**
 * The learner's own glossary, shared by every surface that explains a word.
 *
 * It reads as an empty glossary until the library answers, because an empty
 * glossary is what a learner who has written none has: a panel that showed
 * nothing at all while loading would look like a failure, and a panel that showed
 * invented terms would be putting words in their mouth.
 */
export function useReadingGlossary(){
 useTranslation();
 const [state,setState]=useState<{glossary:SensaReadingGlossary;saved:boolean}|null>(null);
 const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true);
 const refresh=async()=>{const next=await readingGlossarySnapshot();if(mounted.current)setState(next);};
 useEffect(()=>{
  mounted.current=true;
  const read=()=>void refresh().catch(()=>setNotice(localFlowText('glossaryReadFailed')));
  read();
  const stop=observeLibrary(read);
  return()=>{mounted.current=false;stop();};
 },[]);
 /** A write refreshes from storage rather than trusting what it returned: two
  * tabs can edit the same glossary, and only the library knows which edit stands. */
 const perform=async(work:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await work();await refresh();setNotice(localFlowText('glossarySaved'));}catch{setNotice(localFlowText('glossarySaveFailed'));}finally{setBusy(false);}};
 return {
  glossary:state?.glossary??[],saved:state?.saved??false,busy,notice:localFlowNotice(notice),
  add:(inputLanguageTag:string,outputLanguageTag:string,term:string,rendering:string)=>perform(()=>setReadingGlossaryEntry(crypto.randomUUID(),inputLanguageTag,outputLanguageTag,term,rendering)),
  remove:(inputLanguageTag:string,outputLanguageTag:string,term:string)=>perform(()=>removeReadingGlossaryEntry(crypto.randomUUID(),inputLanguageTag,outputLanguageTag,term)),
 };
}
