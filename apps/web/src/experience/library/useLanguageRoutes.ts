import {useTranslation} from 'react-i18next';
import {useEffect,useRef,useState} from 'react';
import {
  defaultSensaLanguageRoute,
  defaultSensaLanguageRouteCollection,
  sensaLanguageForRole,
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
import {settleOperation} from './operationSettlement';
import {createRefreshCoordinator} from './refreshCoordinator';

type Snapshot={
  collection:SensaLanguageRouteCollection;
  activeRoute:SensaLanguageLearningRoute;
  context:SensaFormalPinnedLanguageContext;
  packageCounts:Record<string,number>;
  speechConfiguredLanguages:string[];
  availabilityLoaded:boolean;
  saved:boolean;
};

export type LanguageRouteAvailability={
  installedPackageCount:number;
  personalVoiceConfigured:boolean;
};

const defaultSnapshot:Snapshot={
  collection:defaultSensaLanguageRouteCollection,
  activeRoute:defaultSensaLanguageRoute,
  context:sensaPinnedLanguageContext(defaultSensaLanguageRoute),
  packageCounts:{},
  speechConfiguredLanguages:[],
  availabilityLoaded:false,
  saved:false,
};

/** React binding for the Language Route module. Consumers see one already
 * resolved active Route and context; storage and selection repair stay hidden. */
export function useLanguageRoutes(){
  useTranslation();
  const [state,setState]=useState<Snapshot|null>(null);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const mounted=useRef(true);
  const refreshGeneration=useRef(0);
  const refresh=async()=>{
    const generation=++refreshGeneration.current;
    const [next,supplyModule,speechApi]=await Promise.all([
      languageRoutesSnapshot(),
      import('../../contentSupply/system/contentSupplySystem'),
      import('../../data/library/speech/edgeVoiceCatalog'),
    ]);
    const routes=await supplyModule.contentSupplySystem.read({kind:'route_counts'});
    const packageCounts:Record<string,number>={};
    for(const route of routes){
      const key=JSON.stringify([route.targetLanguage,route.supportLanguage]);
      packageCounts[key]=route.packageCount;
    }
    const speechConfiguredLanguages=sensaLanguageForRole('target').map(({tag})=>tag).filter(tag=>speechApi.defaultClientSpeechConfiguredFor(tag));
    if(mounted.current&&generation===refreshGeneration.current)setState({...next,packageCounts,speechConfiguredLanguages,availabilityLoaded:true});
  };
  useEffect(()=>{
    let active=true;
    mounted.current=true;
    const coordinator=createRefreshCoordinator(refresh);
    const read=()=>void coordinator.request().catch(()=>{if(active&&mounted.current)setNotice(localFlowText('languageReadFailed'));});
    read();
    const stop=observeLibrary(read,['settings','meta'],{settings:['language-learning-routes'],meta:['active-language-route:web']});
    let stopSupply:(()=>void)|null=null;
    void import('../../contentSupply/system/contentSupplySystem').then(({contentSupplySystem})=>{
      if(active&&mounted.current)stopSupply=contentSupplySystem.subscribe({kind:'route_counts'},read);
    }).catch(()=>{if(active&&mounted.current)setNotice(localFlowText('languageReadFailed'));});
    return()=>{active=false;mounted.current=false;stop();stopSupply?.();};
  },[]);
  const perform=async<T,>(work:()=>Promise<T>)=>{
    setBusy(true);setNotice('');
    try{const outcome=await settleOperation(work,refresh);if(outcome.kind==='rejected'){const error=outcome.error;setNotice(error instanceof Error&&error.message.startsWith('localFlow.')?error.message:localFlowText('languageReadFailed'));return null;}if(outcome.projection==='stale')setNotice(localFlowText('languageReadFailed'));return outcome.value;}
    finally{setBusy(false);}
  };
  const snapshot=state??defaultSnapshot;
  const availabilityFor=(targetLanguageTag:string,supportLanguageTag:string):LanguageRouteAvailability|undefined=>snapshot.availabilityLoaded?{
    installedPackageCount:snapshot.packageCounts[JSON.stringify([targetLanguageTag,supportLanguageTag])]??0,
    personalVoiceConfigured:snapshot.speechConfiguredLanguages.includes(targetLanguageTag),
  }:undefined;
  return {
    ...snapshot,
    availabilityFor,
    busy,
    notice:localFlowNotice(notice),
    refresh,
    addRoute:(targetLanguageTag:string,supportLanguageTag:string)=>perform(()=>addLanguageRoute(crypto.randomUUID(),targetLanguageTag,supportLanguageTag)),
    updateSupport:(routeId:string,supportLanguageTag:string)=>perform(()=>updateLanguageRouteSupport(crypto.randomUUID(),routeId,supportLanguageTag)),
    setStatus:(routeId:string,status:SensaLanguageRouteStatus)=>perform(()=>setLanguageRouteStatus(crypto.randomUUID(),routeId,status)),
    setActive:(routeId:string)=>perform(()=>setActiveLanguageRoute(crypto.randomUUID(),routeId)),
  };
}
