import type {CaptureSnapshot} from '@sensa/contracts/sensa';

/** Preserve exact occurrence offsets; inspect only the selected local text block. */
export function captureSelection(range: Range): CaptureSnapshot | null {
  const start = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement : range.startContainer as Element;
  const end = range.endContainer.nodeType === Node.TEXT_NODE
    ? range.endContainer.parentElement : range.endContainer as Element;
  const excluded = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,noscript';
  if (!start || !end || start.closest(excluded) || end.closest(excluded)) return null;
  let block: Element | null = start;
  while (block && block !== document.body && block !== document.documentElement) {
    if (block.matches('p,li,blockquote,td,th,dt,dd,h1,h2,h3,h4,h5,h6,pre,figcaption') ||
      ['block', 'list-item'].includes(getComputedStyle(block).display)) break;
    block = block.parentElement;
  }
  if (!block || block === document.body || block === document.documentElement || !block.contains(range.endContainer)) return null;
  const text = block.textContent ?? '';
  const selected = range.toString();
  if (text.length > 24000 || !selected.trim() || selected.length > 2000) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const from = prefix.toString().length;
  const to = from + selected.length;
  const sentence = Array.from(new Intl.Segmenter('en', {granularity: 'sentence'}).segment(text))
    .find(segment => segment.index <= from && segment.index + segment.segment.length >= to);
  const raw = sentence?.segment ?? selected;
  const offset = sentence ? from - sentence.index : 0;
  if (raw.length > 12000) return null;
  return {
    sentence: raw,
    language: 'en',
    expression: sentence ? {text: selected, start: Array.from(raw.slice(0, offset)).length,
      end: Array.from(raw.slice(0, offset + selected.length)).length} : null,
    source: {url: location.href, title: document.title.slice(0, 1000), capturedAt: new Date().toISOString()},
  };
}
