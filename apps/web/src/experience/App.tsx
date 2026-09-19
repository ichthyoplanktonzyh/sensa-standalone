import {lazy,Suspense,useCallback,useMemo} from 'react';
import {localFlowText} from '../i18n/localFlowText';
import {IconSprite} from './components/IconSprite';
import {DictionaryPresentationProvider} from './components/DictionaryPresentationContext';
import {WebShell} from './ui/WebShell';
import {ScreenHost,ScreenMemoryProvider} from './ui/ScreenHost';
import type {PracticeSenseItem} from './practiceData';
import {
  contentSenseForId,
  isContentSectionId,
  type ContentNoteItem,
  type ContentSectionId,
  type SavedExampleItem,
} from './contentProjection';
import {useShellNavigation} from './router/useShellNavigation';
import {screenInstanceKey} from './router/shellLocation';
import {usePresentationStore} from './stores/presentationStore';
import {useOverlayStore} from './stores/overlayStore';

const HomeLearningController=lazy(()=>import('./library/HomeLearningController').then(module=>({default:module.HomeLearningController})));
const LearningWorkspace=lazy(()=>import('./library/LearningWorkspace').then(module=>({default:module.LearningWorkspace})));
const PersonalMeaningDetailScreen=lazy(()=>import('./components/PersonalMeaningDetailScreen').then(module=>({default:module.PersonalMeaningDetailScreen})));
const ExpressionBindingScreen=lazy(()=>import('./components/ExpressionBindingScreen').then(module=>({default:module.ExpressionBindingScreen})));
const ContentLibraryScreen=lazy(()=>import('./components/ContentLibraryScreen').then(module=>({default:module.ContentLibraryScreen})));
const ContentSenseDetailScreen=lazy(()=>import('./components/ContentSenseDetailScreen').then(module=>({default:module.ContentSenseDetailScreen})));
const ContentExampleDetailScreen=lazy(()=>import('./components/ContentExampleDetailScreen').then(module=>({default:module.ContentExampleDetailScreen})));
const ContentComingSoonScreen=lazy(()=>import('./components/ContentComingSoonScreen').then(module=>({default:module.ContentComingSoonScreen})));
const DictDetailModal=lazy(()=>import('./components/DictDetailModal').then(module=>({default:module.DictDetailModal})));
const ReferenceDictionaryScreen=lazy(()=>import('./components/ReferenceDictionaryScreen').then(module=>({default:module.ReferenceDictionaryScreen})));
const ReferenceExampleViewer=lazy(()=>import('./components/ReferenceExampleViewer').then(module=>({default:module.ReferenceExampleViewer})));
const NoteEditorModal=lazy(()=>import('./components/NoteEditorModal').then(module=>({default:module.NoteEditorModal})));
const SceneEditorModal=lazy(()=>import('./components/SceneEditorModal').then(module=>({default:module.SceneEditorModal})));

const LEARNING_WORKSPACE_SCREENS=new Set([
 's-academy','s-practice-scope','s-real-world-listening',
 's-content','s-semantic-world','s-confirmed-sense',
 's-study','s-learning-library','s-learning-entry','s-learning-target','s-stats','s-profile',
]);

export default function App(){
 const {viewMode,mainStack,params,goMain,backMain,setMainStack}=useShellNavigation();
 const dictionaryPresentation=usePresentationStore(state=>state.dictionary);
 const contentSection:ContentSectionId=isContentSectionId(params.section)?params.section:'recent';
 const contentComingKind:'scenes'|'collections'=params.coming==='collections'?'collections':'scenes';
 const personalMeaningId=params.meaningId??null;
 const meaningFocusId=params.focusId??null;
 const selectedContentSense=useMemo(()=>params.senseId?contentSenseForId(params.senseId):null,[params.senseId]);
 const selectedContentExample=useMemo(()=>params.exampleId?contentSenseForId(params.exampleId):null,[params.exampleId]);
 const openContentSense=useCallback((item:PracticeSenseItem)=>goMain('s-content-sense',{senseId:item.senseId}),[goMain]);
 const openPersonalMeaning=useCallback((meaningId:string,focusId?:string)=>goMain('s-personal-meaning',{meaningId,focusId}),[goMain]);
 const openConfirmedSense=useCallback((meaningId:string,focusId:string)=>goMain('s-confirmed-sense',{meaningId,focusId}),[goMain]);
 const openContentExample=useCallback((item:PracticeSenseItem)=>goMain('s-content-example',{exampleId:item.senseId}),[goMain]);

 const dictModalWord=useOverlayStore(state=>state.dictModalWord);
 const dictModalTab=useOverlayStore(state=>state.dictModalTab);
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
 const learningWorkspaceActive=viewMode==='lightweight'||LEARNING_WORKSPACE_SCREENS.has(currentScreen);
 const hostedScreenKey=learningWorkspaceActive?'learning-workspace':screenInstanceKey(currentScreen,params);
 const overlayOpen=!!dictModalWord||!!referenceExampleDeck||!!noteModalWord||!!sceneEditorTarget;
 const baseActive=!overlayOpen;
 const renderScreen=(active:boolean)=>{
  if(learningWorkspaceActive)return <LearningWorkspace active={active}/>;
  switch(currentScreen){
   case 's-home': return <HomeLearningController active={active}/>;
   case 's-personal-meaning': return <PersonalMeaningDetailScreen
    key={personalMeaningId} active={active} personalMeaningId={personalMeaningId}
    onConversationCreated={openPersonalMeaning} onBack={backMain}
    onOpenConfirmedSense={openConfirmedSense} toast={toast}/>;
   case 's-expression-binding': return <ExpressionBindingScreen
    active={active} personalMeaningId={personalMeaningId} meaningFocusId={meaningFocusId}
    onBack={backMain} toast={toast}/>;
   case 's-content-library': return <ContentLibraryScreen
    active={active} section={contentSection} onBack={backMain} onOpenSense={openContentSense}
    onOpenExample={(entry:SavedExampleItem)=>openContentExample(entry.sense)}
    onEditNote={(entry:ContentNoteItem)=>{
     if(entry.sense&&!entry.isLegacy)openNoteEditor(entry.sense.sourceWord,entry.sense.senseId,entry.sense.meaning);
     else openNoteEditor(entry.word);
    }}/>;
   case 's-content-sense': return <ContentSenseDetailScreen
    active={active} item={selectedContentSense} onBack={backMain} onOpenExample={openContentExample}
    onOpenSense={item=>goMain('s-content-sense',{senseId:item.senseId})}
    onOpenDictionary={item=>openDictModal(item.sourceWord)}
    onEditNote={item=>openNoteEditor(item.sourceWord,item.senseId,item.meaning)} toast={toast}/>;
   case 's-content-example': return <ContentExampleDetailScreen
    active={active} item={selectedContentExample} onBack={backMain}
    onOpenSense={item=>{
     const nextStack=mainStack.includes('s-content-sense')?mainStack.slice(0,-1):[...mainStack.slice(0,-1),'s-content-sense'];
     setMainStack(nextStack,{senseId:item.senseId});
    }} toast={toast}/>;
   case 's-content-coming': return <ContentComingSoonScreen active={active} kind={contentComingKind} onBack={backMain}/>;
   default: return null;
  }
 };
 const fallback=<section id={currentScreen} className="screen active absolute inset-0 grid place-content-center bg-surface-canvas text-fg-primary" role="status">{localFlowText('loadingSensa')}</section>;
 return <ScreenMemoryProvider><DictionaryPresentationProvider presentation={dictionaryPresentation}>
  <IconSprite/>
  <WebShell current={viewMode==='lightweight'?'s-lightweight-runtime':currentScreen} focused={viewMode!=='main'} onNavigate={id=>setMainStack(id==='s-home'?[]:[id])}>
    <ScreenHost screenKey={hostedScreenKey} memoryKey={hostedScreenKey} preserveScroll={!learningWorkspaceActive} active={baseActive} fallback={fallback}>
     {renderScreen}
    </ScreenHost>
    <Suspense fallback={null}>
    {dictModalWord&&(dictionaryPresentation==='baseline'
     ?<DictDetailModal active wordData={dictModalWord} initialTab={dictModalTab} onClose={closeDictModal} toast={toast}/>
     :<ReferenceDictionaryScreen active={!referenceExampleDeck} wordData={dictModalWord} onClose={closeDictModal} onOpenExamples={setReferenceExampleDeck}/>)}
    {referenceExampleDeck&&<ReferenceExampleViewer active={dictionaryPresentation==='sensa'} deck={referenceExampleDeck} onClose={()=>setReferenceExampleDeck(null)}/>}
    {noteModalWord&&<NoteEditorModal active wordData={noteModalWord} senseId={noteModalSense?.senseId} senseMeaning={noteModalSense?.meaning} onClose={closeNoteEditor} toast={toast}/>}
    {sceneEditorTarget&&<SceneEditorModal active senseId={sceneEditorTarget.content.senseKey} word={sceneEditorTarget.content.lemma} senseMeaning={sceneEditorTarget.content.guideLabelL1} anchorId={sceneEditorTarget.anchorId} learningTarget={sceneEditorTarget.learningTarget} onClose={closeSceneEditor} toast={toast}/>}
    </Suspense>
    {toastMsg&&<div className="sensa-motion-popover fixed bottom-6 left-1/2 z-[150] max-w-[calc(100%-3rem)] -translate-x-1/2 rounded-control bg-fg-primary px-5 py-3 text-center text-control-label text-surface-canvas shadow-overlay" id="toast" role="status" aria-live="polite">{toastMsg}</div>}
  </WebShell>
 </DictionaryPresentationProvider></ScreenMemoryProvider>;
}
