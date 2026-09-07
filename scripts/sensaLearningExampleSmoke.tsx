import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { SensaExampleScreen } from '../apps/web/src/experience/components/SensaExampleScreen';
import { LearningExampleLookup } from '../apps/web/src/experience/components/examples/LearningExampleLookup';
import { audioService } from '../apps/web/src/experience/services/audioService';
import { personalContentService } from '../apps/web/src/experience/services/personalContentService';
import type { Word, QuickDictEntry } from '../apps/web/src/experience/types';

async function main() {
  const window = new Window({ url: 'http://localhost:3000/study' });
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let closes = 0, advances = 0, stops = 0;
  const messages: string[] = [];
  const saved: string[] = [];
  const originalStop = audioService.stop, originalPlay = audioService.playAudioUrl;
  const originalSave = personalContentService.toggleExample;
  audioService.stop = () => { stops++; };
  audioService.playAudioUrl = async () => { throw new Error('offline'); };
  personalContentService.toggleExample = id => { saved.push(id); return true; };
  const word: Word = { id: 'example-test', w: 'borrow', syl: '', ph: '', total: 2, def: 'Use and return.', senses: [{ pos: 'v.', items: ['借入'] }], options: [], mnemo: {}, sentences: [
    { en: 'First <b>borrow</b> example.', zh: '第一条例句', src: 'Reviewed source', theme: '', audioUrl: '/test.mp3', contextL2: 'Full context.' },
    { en: 'Second <b>borrow</b> example.', zh: '第二条例句', src: 'Reviewed source', theme: '' },
  ] };
  const props = { active: true, curWord: word, onClose: () => { closes++; }, onNextWord: () => { advances++; }, toast: (message: string) => messages.push(message) };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    assert.ok(button, label); await act(() => button.click());
  };
  try {
    await act(() => root.render(<SensaExampleScreen {...props} initialSentenceIdx={1} />));
    assert.ok(container.textContent?.includes('Second'));
    assert.equal(container.querySelector('nav'), null, 'single authorized resource cannot browse siblings');
    await click('收藏这条例句'); assert.equal(saved.at(-1), 'example-test:example:0:1');
    await click('隐藏译文'); assert.ok(!container.textContent?.includes('第二条例句'));
    await click('显示译文'); assert.ok(container.textContent?.includes('第二条例句'));
    await act(() => root.render(<SensaExampleScreen {...props} sentenceSequence={[0, 1]} />));
    await click('完整上下文+'); assert.ok(container.textContent?.includes('Full context.'));
    const carousel = container.querySelector('.example-card-carousel');
    assert.ok(carousel);
    await act(() => carousel.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 200, pointerId: 1 })));
    await act(() => carousel.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 50, pointerId: 1 })));
    await act(() => carousel.dispatchEvent(new window.PointerEvent('pointercancel', { bubbles: true, clientX: 50, pointerId: 1 })));
    assert.ok(container.textContent?.includes('First'), 'cancelled touch gesture does not navigate');
    await click('播放例句'); assert.ok(messages.includes('音频播放失败，请重试'));
    assert.ok(container.querySelector('[aria-label="播放例句"]'), 'failure resets playback');
    await click('下一条例句'); await click('收藏这条例句');
    assert.equal(saved.at(-1), 'example-test:example:0:1', 'save identity independent of authorized sequence');
    await click('返回学习'); assert.equal(closes, 1); assert.equal(advances, 0);
    await act(() => root.render(<SensaExampleScreen {...props} sentenceSequence={[99]} />));
    assert.ok(container.textContent?.includes('暂时不可用'));
    assert.ok(container.querySelector<HTMLButtonElement>('[aria-label="收藏这条例句"]')?.disabled);
    assert.ok(!container.textContent?.includes('First'), 'invalid resource must not silently substitute another example');
    await act(() => root.render(<SensaExampleScreen {...props} />));
    personalContentService.toggleExample = () => { throw new Error('storage full'); };
    await click('收藏这条例句'); assert.ok(messages.includes('收藏未能保存，请重试'));

    const entry: QuickDictEntry = { word: 'borrow', phonetic: '', senses: [{ pos: 'v.', text: '借入' }], lookupState: 'ready' };
    let received: QuickDictEntry | undefined;
    const lookupProps = { onClose: () => { closes++; }, toast: props.toast, onViewDetail: (value: QuickDictEntry) => { received = value; } };
    await act(() => root.render(<LearningExampleLookup {...lookupProps} entry={{ ...entry, senses: [], lookupState: 'loading', lookupMessage: '正在查询词典…' }} />));
    assert.equal(container.querySelector('[role="dialog"]')?.getAttribute('aria-busy'), 'true');
    assert.ok([...container.querySelectorAll('button')].find(button => button.textContent === '查看详细释义')?.disabled);
    await act(() => root.render(<LearningExampleLookup {...lookupProps} entry={entry} />));
    const lookupButtons = [...container.querySelectorAll('button')];
    lookupButtons.at(-1)?.focus();
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', cancelable: true })));
    assert.equal(document.activeElement, lookupButtons[0], 'lookup traps keyboard focus');
    await click('查看详细释义'); assert.equal(received, entry, 'detail receives exact contextual object');
    await act(() => root.render(<LearningExampleLookup {...lookupProps} entry={{ ...entry, senses: [], lookupState: 'error', lookupMessage: '查询失败' }} />));
    assert.ok(container.textContent?.includes('再次点击单词查询'));
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
    assert.equal(closes, 2);
    assert.ok(stops > 0);
    console.log('Learning example smoke passed: authorized sequence, stable saves, translation, unavailable resource, audio/save failures, navigation, lookup states and exact detail handoff. No provider calls.');
  } finally {
    await act(() => root.unmount());
    audioService.stop = originalStop; audioService.playAudioUrl = originalPlay; personalContentService.toggleExample = originalSave;
    await window.happyDOM.abort();
  }
}
void main();
