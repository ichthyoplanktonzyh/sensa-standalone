import {
  defaultSensaLanguageRouteCollection,
  sensaFormalPinnedLanguageContextSchema,
  sensaLanguageForDeclaredTag,
  sensaLanguageLearningRouteSchema,
  sensaLanguageRouteCollectionSchema,
  sensaPinnedLanguageContext,
  type SensaLanguageRouteCollection,
  type SensaLanguageRouteStatus,
  type SensaFormalPinnedLanguageContext,
} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction} from './store';

/** Routes are learner-owned and sync with the library. The active choice is a
 * Web-device preference and lives in `meta`, which cloud sync deliberately does
 * not replicate except for its small allow-list. */
const ROUTES_KEY='language-learning-routes';
const ACTIVE_ROUTE_KEY='active-language-route:web';

export const readLanguageRoutes=async(tx:LibraryTransaction):Promise<SensaLanguageRouteCollection>=>{
  const stored=await tx.get<unknown>('settings',ROUTES_KEY);
  return stored===undefined?defaultSensaLanguageRouteCollection:sensaLanguageRouteCollectionSchema.parse(stored);
};

const selectable=(collection:SensaLanguageRouteCollection)=>collection.routes.filter(route=>route.status==='active');

async function resolveActiveRoute(tx:LibraryTransaction,collection:SensaLanguageRouteCollection){
  const selectedId=await tx.get<string>('meta',ACTIVE_ROUTE_KEY);
  return selectable(collection).find(route=>route.id===selectedId)??selectable(collection)[0]??null;
}

export const languageRoutesSnapshot=()=>readLibrary(async tx=>{
  const collection=await readLanguageRoutes(tx);
  const activeRoute=await resolveActiveRoute(tx,collection);
  if(!activeRoute)throw new Error('localFlow.noActiveLanguageRoute');
  return {collection,activeRoute,context:sensaPinnedLanguageContext(activeRoute),saved:await tx.get('settings',ROUTES_KEY)!==undefined};
});

/** Resolve once at an operation boundary; callers keep this returned value for
 * the lifetime of that operation instead of consulting the active route again. */
export const activeLanguageContextSnapshot=async():Promise<SensaFormalPinnedLanguageContext>=>
  (await languageRoutesSnapshot()).context;

/** A formal command may use any live Route, but it must name its current
 * revision and exact pair. This prevents a stale dialog from silently binding
 * new Curriculum work after the Route changed. */
export async function requireLanguageRouteContext(tx:LibraryTransaction,context:SensaFormalPinnedLanguageContext){
  const parsed=sensaFormalPinnedLanguageContextSchema.parse(context);
  const collection=await readLanguageRoutes(tx);
  const route=collection.routes.find(value=>value.id===parsed.languageRouteId&&value.status==='active');
  if(!route)throw new Error('localFlow.unknownLanguageRoute');
  if(route.revision!==parsed.languageRouteRevision||route.targetLanguageTag!==parsed.targetLanguageTag||route.defaultSupportLanguageTag!==parsed.supportLanguageTag)throw new Error('localFlow.languageRouteChanged');
  return route;
}

async function writeRoutes(tx:LibraryTransaction,collection:SensaLanguageRouteCollection){
  const parsed=sensaLanguageRouteCollectionSchema.parse(collection);
  tx.put('settings',ROUTES_KEY,parsed);
  return parsed;
}

function requireRouteLanguages(targetLanguageTag:string,defaultSupportLanguageTag:string){
  const target=sensaLanguageForDeclaredTag(targetLanguageTag);
  const support=sensaLanguageForDeclaredTag(defaultSupportLanguageTag);
  if(target?.asTarget!==true)throw new Error('localFlow.unknownTargetLanguage');
  if(!support)throw new Error('localFlow.unknownSupportLanguage');
  return sensaLanguageLearningRouteSchema.parse({
    id:crypto.randomUUID(),revision:1,targetLanguageTag,defaultSupportLanguageTag,status:'active',
  });
}

export function addLanguageRoute(operationId:string,targetLanguageTag:string,defaultSupportLanguageTag:string){
  return command({id:operationId,kind:'languageRoute.add',input:{targetLanguageTag,defaultSupportLanguageTag}},async tx=>{
    const proposed=requireRouteLanguages(targetLanguageTag,defaultSupportLanguageTag);
    const current=await readLanguageRoutes(tx);
    const duplicate=current.routes.find(route=>route.status!=='archived'&&route.targetLanguageTag===targetLanguageTag&&route.defaultSupportLanguageTag===defaultSupportLanguageTag);
    if(duplicate)return duplicate;
    const archived=current.routes.find(route=>route.status==='archived'&&route.targetLanguageTag===targetLanguageTag&&route.defaultSupportLanguageTag===defaultSupportLanguageTag);
    const route=archived?{...archived,status:'active' as const,revision:archived.revision+1}:proposed;
    const routes=archived?current.routes.map(value=>value.id===route.id?route:value):[...current.routes,route];
    await writeRoutes(tx,{revision:current.revision+1,routes});
    return route;
  });
}

export function updateLanguageRouteSupport(operationId:string,routeId:string,defaultSupportLanguageTag:string){
  return command({id:operationId,kind:'languageRoute.support',input:{routeId,defaultSupportLanguageTag}},async tx=>{
    if(!sensaLanguageForDeclaredTag(defaultSupportLanguageTag))throw new Error('localFlow.unknownSupportLanguage');
    const current=await readLanguageRoutes(tx),route=current.routes.find(value=>value.id===routeId);
    if(!route||route.status==='archived')throw new Error('localFlow.unknownLanguageRoute');
    if(route.defaultSupportLanguageTag===defaultSupportLanguageTag)return route;
    if(current.routes.some(value=>value.id!==routeId&&value.status!=='archived'&&value.targetLanguageTag===route.targetLanguageTag&&value.defaultSupportLanguageTag===defaultSupportLanguageTag))throw new Error('localFlow.duplicateLanguageRoute');
    const next={...route,defaultSupportLanguageTag,revision:route.revision+1};
    await writeRoutes(tx,{revision:current.revision+1,routes:current.routes.map(value=>value.id===routeId?next:value)});
    return next;
  });
}

export function setLanguageRouteStatus(operationId:string,routeId:string,status:SensaLanguageRouteStatus){
  return command({id:operationId,kind:'languageRoute.status',input:{routeId,status}},async tx=>{
    const current=await readLanguageRoutes(tx),route=current.routes.find(value=>value.id===routeId);
    if(!route)throw new Error('localFlow.unknownLanguageRoute');
    if(route.status===status)return route;
    const next={...route,status,revision:route.revision+1};
    const routes=current.routes.map(value=>value.id===routeId?next:value);
    if(!routes.some(value=>value.status==='active'))throw new Error('localFlow.lastLanguageRoute');
    await writeRoutes(tx,{revision:current.revision+1,routes});
    if(await tx.get<string>('meta',ACTIVE_ROUTE_KEY)===routeId&&status!=='active'){
      tx.put('meta',ACTIVE_ROUTE_KEY,routes.find(value=>value.status==='active')!.id);
    }
    return next;
  });
}

export function setActiveLanguageRoute(operationId:string,routeId:string){
  return command({id:operationId,kind:'languageRoute.select',input:{routeId}},async tx=>{
    const current=await readLanguageRoutes(tx),route=current.routes.find(value=>value.id===routeId&&value.status==='active');
    if(!route)throw new Error('localFlow.unknownLanguageRoute');
    tx.put('meta',ACTIVE_ROUTE_KEY,route.id);
    return route;
  });
}
