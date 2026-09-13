import {captureSelection} from './selection';
import {showReadingPanel} from './readingPanel';
import {createPageReading} from './pageReading';
import {createYoutubeReading} from './youtubeReading';
import {defaultPreferences} from './preferences';
import type {ReadingPreferences} from './preferences';

// Injected only after activeTab authorization; capture stays within the selected block.
const installed = globalThis as typeof globalThis & {__sensaCaptureInstalled?: boolean};
if (!installed.__sensaCaptureInstalled) {
  installed.__sensaCaptureInstalled = true;
  let accountId: string | null = null;
  let enabled = false;
  let suspended = false;
  let navigating = false;
  let preferences:ReadingPreferences=defaultPreferences;
  let pageSurface:ReturnType<typeof createPageReading>|null=null;
  let videoSurface:ReturnType<typeof createYoutubeReading>=null;
  let pageUrl='';
  let subtitlesRequested=false;
  let current: ReturnType<typeof showReadingPanel> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dismissedRange: Range | null = null;
  const fromPanel = (event: Event) => Boolean(current && event.composedPath().includes(current.host));
  const close = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current?.destroy();
    current = null;
  };
  function stopSurfaces(){pageSurface?.destroy();videoSurface?.destroy();pageSurface=null;videoSurface=null;pageUrl='';}
  function startSurfaces(){
    if(suspended||navigating||!enabled||!accountId||preferences.disabledSites.includes(location.hostname)){stopSurfaces();return;}
    if(pageUrl===location.href)return;close();stopSurfaces();pageUrl=location.href;const owner=accountId;
    const isAuthorized=()=>!suspended&&enabled&&accountId===owner&&!preferences.disabledSites.includes(location.hostname);
    pageSurface=createPageReading(owner,isAuthorized);
    videoSurface=createYoutubeReading(owner,isAuthorized,(snapshot,range)=>{close();current=showReadingPanel({snapshot,range,accountId:owner,close,isAuthorized,keyboard:false,preferences});},{autoLoad:subtitlesRequested,onLoaded:()=>{subtitlesRequested=true;}});
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.kind !== 'reading') return;
    const changed=accountId!==message.accountId||JSON.stringify(preferences)!==JSON.stringify(message.preferences??defaultPreferences);
    if(changed){close();stopSurfaces();subtitlesRequested=false;}
    preferences=message.preferences??defaultPreferences;
    accountId = message.accountId ?? null;
    enabled = message.enabled === true && Boolean(accountId);
    if (!enabled) {close();stopSurfaces();subtitlesRequested=false;}
    else startSurfaces();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
  document.addEventListener('pointerdown', event => {
    if (fromPanel(event)) return;
    dismissedRange = null;
    if (current) {
      const selection = getSelection();
      dismissedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      close();
    }
  });
  async function selected(keyboard = false) {
    if (suspended || !enabled || !accountId || preferences.disabledSites.includes(location.hostname)) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0).cloneRange();
    const owner = accountId;
    const stillWanted = () => !suspended && enabled && accountId === owner && !preferences.disabledSites.includes(location.hostname);
    // Detection is asynchronous, so the reading mode may have been switched off
    // or the account changed while it ran; the panel is only opened for a
    // selection that is still wanted.
    const snapshot = await captureSelection(range);
    if (!snapshot || !stillWanted()) return;
    close();
    // The wider capture is cut from the same frozen range, so the block context
    // cannot disagree with the sentence about what language it is in.
    const wider = await captureSelection(range, 'block');
    if (!stillWanted()) return;
    current = showReadingPanel({snapshot, contextAlternative:wider?{...wider,source:snapshot.source}:undefined, range, accountId: owner, close,
      isAuthorized: () => enabled && accountId === owner, keyboard,preferences});
  }
  document.addEventListener('pointerup', event => {
    // Check before click can remove the closed shadow host.
    if (fromPanel(event) || event.button !== 0 || event.composedPath().some(n=>n instanceof HTMLElement&&n.dataset.sensaUi)) return;
    const dismissed = dismissedRange;
    dismissedRange = null;
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (dismissed && range && range.startContainer === dismissed.startContainer &&
      range.startOffset === dismissed.startOffset && range.endContainer === dismissed.endContainer &&
      range.endOffset === dismissed.endOffset) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; selected(); }, 0);
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Shift' && !fromPanel(event)) selected(true);
  });
  window.addEventListener('pagehide', ()=>{suspended=true;close();stopSurfaces();});
  window.addEventListener('pageshow', ()=>{suspended=false;navigating=false;startSurfaces();});
  window.addEventListener('popstate', close);
  window.addEventListener('hashchange', close);
  setInterval(()=>{if(enabled&&pageUrl!==location.href)startSurfaces();},500);
  document.addEventListener('yt-navigate-start',()=>{navigating=true;close();stopSurfaces();});
  document.addEventListener('yt-navigate-finish',()=>{navigating=false;startSurfaces();});
}
