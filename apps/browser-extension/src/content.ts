import {captureSelection} from './selection';
import {showReadingPanel} from './readingPanel';

// Injected only after activeTab authorization; capture stays within the selected block.
const installed = globalThis as typeof globalThis & {__sensaCaptureInstalled?: boolean};
if (!installed.__sensaCaptureInstalled) {
  installed.__sensaCaptureInstalled = true;
  let accountId: string | null = null;
  let enabled = false;
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
  chrome.runtime.onMessage.addListener(message => {
    if (message.kind !== 'reading') return;
    if (accountId !== message.accountId) close();
    accountId = message.accountId ?? null;
    enabled = message.enabled === true && Boolean(accountId);
    if (!enabled) close();
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
  function selected(keyboard = false) {
    if (!enabled || !accountId) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0).cloneRange();
    const snapshot = captureSelection(range);
    if (!snapshot) return;
    close();
    const owner = accountId;
    current = showReadingPanel({snapshot, range, accountId: owner, close,
      isAuthorized: () => enabled && accountId === owner, keyboard});
  }
  document.addEventListener('pointerup', event => {
    // Check before click can remove the closed shadow host.
    if (fromPanel(event) || event.button !== 0) return;
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
  window.addEventListener('pagehide', close);
  window.addEventListener('popstate', close);
  window.addEventListener('hashchange', close);
}
