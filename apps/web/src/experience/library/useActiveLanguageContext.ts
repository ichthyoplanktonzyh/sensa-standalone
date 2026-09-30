import {useEffect,useState} from 'react';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa/language';

import {languageRoutesSnapshot} from '../../data/library/language';
import {observeLibrary} from '../../data/library/store';
import {createRefreshCoordinator} from './refreshCoordinator';

/** Home needs only the active pinned context, not Route editing, Package
 * availability, speech discovery or their UI state. Keep that wider workspace
 * behind the explicit Language/learning surfaces. */
export function useActiveLanguageContext():SensaFormalPinnedLanguageContext{
 const [context,setContext]=useState(()=>sensaPinnedLanguageContext(defaultSensaLanguageRoute));
 useEffect(()=>{
  let active=true;
  const coordinator=createRefreshCoordinator(async()=>{
   const next=await languageRoutesSnapshot();
   if(active)setContext(next.context);
  });
  const read=()=>void coordinator.request().catch(()=>{});
  read();
  const stop=observeLibrary(read,['settings','meta']);
  return()=>{active=false;stop();};
 },[]);
 return context;
}
