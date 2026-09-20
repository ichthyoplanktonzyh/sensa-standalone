import {lazy,Suspense,useCallback,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {IconSprite} from './components/IconSprite';
import {WebShell} from './ui/WebShell';
import {ScreenHost,ScreenMemoryProvider} from './ui/ScreenHost';
import type {PracticeSenseItem} from './practiceData';
import {isContentSectionId,type ContentSectionId} from './contentRoute';
import type {ContentNoteItem,SavedExampleItem} from './contentProjection';
import {useShellNavigation} from './router/useShellNavigation';
import {screenInstanceKey} from './router/shellLocation';
import {shellScreenHost,type AppShellScreenId} from './router/screenRegistry';
import {useOverlayStore} from './stores/overlayStore';

const HomeLearningController=lazy(()=>import('./library/HomeLearningController').then(module=>({default:module.HomeLearningController})));
const LearningWorkspace=lazy(async()=>{
 const [module]=await Promise.all([
  import('./library/LearningWorkspace'),
  import('../i18n/workspaceResources'),
 ]);
 return {default:module.LearningWorkspace};
});
const PersonalMeaningDetailScreen=lazy(()=>import('./components/PersonalMeaningDetailScreen').then(module=>({default:module.PersonalMeaningDetailScreen})));
const ExpressionBindingScreen=lazy(()=>import('./components/ExpressionBindingScreen').then(module=>({default:module.ExpressionBindingScreen})));
const ContentLibraryScreen=lazy(()=>import('./components/ContentLibraryScreen').then(module=>({default:module.ContentLibraryScreen})));
const ContentSenseDetailScreen=lazy(()=>import('./components/ContentSenseDetailScreen').then(module=>({default:module.ContentSenseDetailScreen})));
const ContentExampleDetailScreen=lazy(()=>import('./components/ContentExampleDetailScreen').then(module=>({default:module.ContentExampleDetailScreen})));
const ContentComingSoonScreen=lazy(()=>import('./components/ContentComingSoonScreen').then(module=>({default:module.ContentComingSoonScreen})));
const ReferenceDictionaryScreen=lazy(()=>import('./components/ReferenceDictionaryScreen').then(module=>({default:module.ReferenceDictionaryScreen})));
const ReferenceExampleViewer=lazy(()=>import('./components/ReferenceExampleViewer').then(module=>({default:module.ReferenceExampleViewer})));
const NoteEditorModal=lazy(()=>import('./components/NoteEditorModal').then(module=>({default:module.NoteEditorModal})));
const SceneEditorModal=lazy(()=>import('./components/SceneEditorModal').then(module=>({default:module.SceneEditorModal})));

type AppScreenId=AppShellScreenId|'s-home';

export default function App(){
 const {t}=useTranslation();
 const {viewMode,mainStack,params,goMain,backMain,setMainStack}=useShellNavigation();
 const contentSection:ContentSectionId=isContentSectionId(params.section)?params.section:'recent';
 const contentComingKind:'scenes'|'collections'=params.coming==='collections'?'collections':'scenes';
 const personalMeaningId=params.meaningId??null;
 const meaningFocusId=params.focusId??null;
 const openContentSense=useCallback((item:PracticeSenseItem)=>goMain('s-content-sense',{senseId:item.senseId}),[goMain]);
 const openPersonalMeaning=useCallback((meaningId:string,focusId?:string)=>goMain('s-personal-meaning',{meaningId,focusId}),[goMain]);
 const openConfirmedSense=useCallback((meaningId:string,focusId:string)=>goMain('s-confirmed-sense',{meaningId,focusId}),[goMain]);
 const openContentExample=useCallback((item:PracticeSenseItem)=>goMain('s-content-example',{exampleId:item.senseId}),[goMain]);

 const dictModalWord=useOverlayStore(state=>state.dictModalWord);
 const referenceExampleDeck=useOverlayStore(state=>state.referenceExampleDeck);
 const openDictModal=useOverlayStore(state=>state.openDictModal);
 const closeDictModal=useOverlayStore(state=>state.closeDictModal);
 const setReferenceExampleDeck=useOverlayStore(state=>state.setReferenceExampleDeck);
 const noteModalWord=useOverlayStore(state=>state.noteModalWord);
 const noteModalSense=useOverlayStore(state=>state.noteModalSense);
 const openNoteEditor=useOverlayStore(state=>state.openNoteEditor);
 const closeNoteEditor=useOverlayStore(state=>state.closeNoteEditor);
 const sceneEditorTarget=useOverlayStore(state=>state.sceneEditorTarget);
 const closeSceneEditor=useOverlayStore(state=>state.closeSceneEditor);
 const toastMsg=useOverlayStore(state=>state.toastMsg);
 const toast=useOverlayStore(state=>state.toast);

 const currentScreen=mainStack.at(-1)??'s-home';
 const learningWorkspaceActive=viewMode==='lightweight'||shellScreenHost(currentScreen)==='learning';
 const hostedScreenKey=learningWorkspaceActive?'learning-workspace':screenInstanceKey(currentScreen,params);
 const overlayOpen=!!dictModalWord||!!referenceExampleDeck||!!noteModalWord||!!sceneEditorTarget;
 const baseActive=!overlayOpen;
 const appScreenRenderers:Record<AppScreenId,(active:boolean)=>ReactNode>={
  's-home':active=><HomeLearningController active={active}/>,
  's-personal-meaning':active=><PersonalMeaningDetailScreen
    key={personalMeaningId} active={active} personalMeaningId={personalMeaningId}
    onConversationCreated={openPersonalMeaning} onBack={backMain}
    onOpenConfirmedSense={openConfirmedSense} toast={toast}/>,
  's-expression-binding':active=><ExpressionBindingScreen
    active={active} personalMeaningId={personalMeaningId} meaningFocusId={meaningFocusId}
    onBack={backMain} toast={toast}/>,
  's-content-library':active=><ContentLibraryScreen
    active={active} section={contentSection} onBack={backMain} onOpenSense={openContentSense}
    onOpenExample={(entry:SavedExampleItem)=>openContentExample(entry.sense)}
    onEditNote={(entry:ContentNoteItem)=>openNoteEditor(entry.sense.sourceWord,entry.sense.senseId,entry.sense.meaning)}/>,
  's-content-sense':active=><ContentSenseDetailScreen
    active={active} senseId={params.senseId??null} onBack={backMain} onOpenExample={openContentExample}
    onOpenSense={item=>goMain('s-content-sense',{senseId:item.senseId})}
    onOpenDictionary={item=>openDictModal(item.sourceWord)}
    onEditNote={item=>openNoteEditor(item.sourceWord,item.senseId,item.meaning)} toast={toast}/>,
  's-content-example':active=><ContentExampleDetailScreen
    active={active} exampleId={params.exampleId??null} onBack={backMain}
    onOpenSense={item=>{
     const nextStack=mainStack.includes('s-content-sense')?mainStack.slice(0,-1):[...mainStack.slice(0,-1),'s-content-sense'];
     setMainStack(nextStack,{senseId:item.senseId});
    }} toast={toast}/>,
  's-content-coming':active=><ContentComingSoonScreen active={active} kind={contentComingKind} onBack={backMain}/>,
 };
 const renderScreen=(active:boolean)=>{
  if(learningWorkspaceActive)return <LearningWorkspace active={active}/>;
  return appScreenRenderers[currentScreen as AppScreenId]?.(active)??null;
 };
 const fallback=<section id={currentScreen} className="screen active absolute inset-0 grid place-content-center bg-surface-canvas text-fg-primary" role="status">{t('reliability.loading')}</section>;
 return <ScreenMemoryProvider>
  <IconSprite/>
  <WebShell current={viewMode==='lightweight'?'s-lightweight-runtime':currentScreen} focused={viewMode!=='main'} onNavigate={id=>setMainStack(id==='s-home'?[]:[id])}>
    <ScreenHost screenKey={hostedScreenKey} memoryKey={hostedScreenKey} preserveScroll={!learningWorkspaceActive} active={baseActive} fallback={fallback}>
     {renderScreen}
    </ScreenHost>
    <Suspense fallback={null}>
    {dictModalWord&&<ReferenceDictionaryScreen active={!referenceExampleDeck} wordData={dictModalWord} onClose={closeDictModal} onOpenExamples={setReferenceExampleDeck}/>}
    {referenceExampleDeck&&<ReferenceExampleViewer active deck={referenceExampleDeck} onClose={()=>setReferenceExampleDeck(null)}/>}
    {noteModalWord&&noteModalSense&&<NoteEditorModal active wordData={noteModalWord} senseId={noteModalSense.senseId} senseMeaning={noteModalSense.meaning} onClose={closeNoteEditor} toast={toast}/>}
    {sceneEditorTarget&&<SceneEditorModal active senseId={sceneEditorTarget.content.senseKey} word={sceneEditorTarget.content.lemma} senseMeaning={sceneEditorTarget.content.guideLabelL1} anchorId={sceneEditorTarget.anchorId} learningTarget={sceneEditorTarget.learningTarget} onClose={closeSceneEditor} toast={toast}/>}
    </Suspense>
    {toastMsg&&<div className="sensa-motion-popover fixed bottom-6 left-1/2 z-[150] max-w-[calc(100%-3rem)] -translate-x-1/2 rounded-control bg-fg-primary px-5 py-3 text-center text-control-label text-surface-canvas shadow-overlay" id="toast" role="status" aria-live="polite">{toastMsg}</div>}
  </WebShell>
 </ScreenMemoryProvider>;
}
