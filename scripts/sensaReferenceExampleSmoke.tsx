import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import { ReferenceExampleViewer, emphasizeReferenceExample, type ReferenceExampleDeck } from '../apps/web/src/experience/components/ReferenceExampleViewer';
import i18n from '../apps/web/src/i18n';

async function main() {
  const window = new Window({ url: 'http://localhost:3000/' });
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const origin = document.createElement('button'); document.body.append(origin); origin.focus();
  let closed = 0;
  const onClose = () => { closed++; };
  const deck: ReferenceExampleDeck = { headword: 'borrow', forms: [], sense: {
    referenceSenseId: 'borrow-1', order: 0, partOfSpeech: 'v.', glossL1: '借入', examples: [
      { exampleId: 'one', textL2: 'Can I borrow it?', textL1: '我能借用吗？', sourceLabel: 'Dictionary source' },
      { exampleId: 'two', textL2: 'Please borrow this.', textL1: '请借用这个。', sourceLabel: 'Dictionary source' },
    ],
  } };
  const render = async (active: boolean, value: ReferenceExampleDeck | null) => {
    await act(async () => { root.render(<ReferenceExampleViewer active={active} deck={value} onClose={onClose}/>); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
    assert.ok(button, label); await act(() => button.click());
  };
  try {
    await render(true, deck);
    assert.ok(container.textContent?.includes('Can I borrow it?'));
    assert.ok(container.textContent?.includes('Dictionary source'));
    assert.ok(container.textContent?.includes('不等同于已审核学习例句'));
    await click('下一条例句');
    assert.ok(container.textContent?.includes('Please borrow this.'));
    await click('隐藏译文'); assert.ok(!container.textContent?.includes('请借用这个。'));
    const body = container.querySelector('main')!;
    body.scrollTop = 120; await act(() => body.dispatchEvent(new window.Event('scroll')));
    await render(false, null); assert.equal(document.activeElement, origin, 'closing restores origin focus');
    origin.focus(); await render(true, deck);
    assert.ok(container.textContent?.includes('Please borrow this.'), 'same context retains example');
    assert.ok(!container.textContent?.includes('请借用这个。'), 'same context retains translation preference');
    assert.equal(container.querySelector('main')?.scrollTop, 120, 'same context restores reading position');
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' })));
    assert.ok(container.textContent?.includes('Can I borrow it?'));
    await act(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
    assert.equal(closed, 1);
    const empty = { ...deck, sense: { ...deck.sense, referenceSenseId: 'empty', examples: [] } };
    await render(true, empty);
    assert.ok(container.textContent?.includes('这个义项暂无参考例句'));
    await click('返回词典'); assert.equal(closed, 2);
    await render(true, { ...deck, sense: { ...deck.sense, referenceSenseId: 'no-translation', examples: [{ exampleId: 'none', textL2: 'borrow', sourceLabel: '' }] } });
    assert.ok(container.textContent?.includes('当前来源未提供译文'));
    assert.ok(container.textContent?.includes('来源信息暂缺'));
    await act(() => i18n.changeLanguage('en'));
    assert.ok(container.textContent?.includes('Dictionary examples'));
    assert.ok(container.textContent?.includes('Example 1 of 1'));
    assert.ok(emphasizeReferenceExample({ exampleId: 'safe', textL2: '<script> borrow & test', sourceLabel: '' }, 'borrow', []).includes('&lt;script&gt; <b>borrow</b> &amp;'));
    await render(true, { ...deck, sense: { ...deck.sense, examples: [{ exampleId: 'safe', textL2: '<script> borrow & test', sourceLabel: '' }] } });
    assert.equal(container.querySelector('script'), null);
    assert.ok(container.textContent?.includes('<script> borrow & test'), 'literal source text remains readable, not HTML or visible entities');
    console.log('Reference example smoke passed: navigation, translation, same-context position, focus restoration, keyboard, empty/missing data, i18n and escaped text. No provider calls.');
  } finally { await act(() => root.unmount()); await window.happyDOM.abort(); }
}
void main();
