import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';
import {
  defaultSensaLanguageRoute,
  defaultSensaLanguageRouteCollection,
  sensaPinnedLanguageContext,
  type SensaLanguageLearningRoute,
  type SensaLanguageRouteCollection,
  type SensaLanguageRouteStatus,
  type SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa/language';
import {observeLibrary} from '../../data/library/store';
import {
  addLanguageRoute,
  languageRoutesSnapshot,
  setActiveLanguageRoute,
  setLanguageRouteStatus,
  updateLanguageRouteSupport,
} from '../../data/library/language';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';

type Snapshot={
  collection:SensaLanguageRouteCollection;
  activeRoute:SensaLanguageLearningRoute;
  context:SensaFormalPinnedLanguageContext;
  saved:boolean;
};

const defaultSnapshot:Snapshot={
  collection:defaultSensaLanguageRouteCollection,
  activeRoute:defaultSensaLanguageRoute,
  context:sensaPinnedLanguageContext(defaultSensaLanguageRoute),
  saved:false,
};

/** React binding for the Language Route module. Consumers see one already
 * resolved active Route and context; storage and selection repair stay hidden. */
export function useLanguageRoutes(){
  useTranslation();
  const [state,setState]=useState<Snapshot|null>(null);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const mounted=useRef(true);
  const refresh=async()=>{const next=await languageRoutesSnapshot();if(mounted.current)setState(next);};
  useEffect(()=>{
    mounted.current=true;
    const read=()=>void refresh().catch(()=>setNotice(localFlowText('languageReadFailed')));
    read();
    const stop=observeLibrary(read,['settings','meta']);
    return()=>{mounted.current=false;stop();};
  },[]);
  const perform=async<T,>(work:()=>Promise<T>)=>{
    setBusy(true);setNotice('');
    try{const result=await work();await refresh();return result;}
    catch(e){setNotice(e instanceof Error&&e.message.startsWith('localFlow.')?e.message:localFlowText('languageReadFailed'));return null;}
    finally{setBusy(false);}
  };
  const snapshot=state??defaultSnapshot;
  return {
    ...snapshot,
    busy,
    notice:localFlowNotice(notice),
    refresh,
    addRoute:(targetLanguageTag:string,supportLanguageTag:string)=>perform(()=>addLanguageRoute(crypto.randomUUID(),targetLanguageTag,supportLanguageTag)),
    updateSupport:(routeId:string,supportLanguageTag:string)=>perform(()=>updateLanguageRouteSupport(crypto.randomUUID(),routeId,supportLanguageTag)),
    setStatus:(routeId:string,status:SensaLanguageRouteStatus)=>perform(()=>setLanguageRouteStatus(crypto.randomUUID(),routeId,status)),
    setActive:(routeId:string)=>perform(()=>setActiveLanguageRoute(crypto.randomUUID(),routeId)),
  };
}
