import {chromium, expect} from '@playwright/test';
import {resolve} from 'node:path';
import {captureSnapshotSchema} from '../packages/contracts/src/sensa/consumer/intake.ts';

// Actual production bundle, real mouse/keyboard and closed Shadow DOM. All network is blocked.
const browser = await chromium.launch({executablePath: process.env.SENSA_CHROMIUM_PATH});
try {
  const page = await browser.newPage({locale:'zh-CN',viewport: {width: 1100, height: 760}});
  await page.route('**/*', route => route.request().url() === 'http://127.0.0.1/reading-fixture'
    ? route.fulfill({contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>Reading fixture</title>
      <style>body{margin:0;font:22px/1.8 system-ui}main{padding:60px;max-width:950px}p{margin:20px 0}#scroll{height:90px;overflow:auto}#scroll p{margin:0}#edge{position:fixed;bottom:0;right:0;margin:0}#outside{position:fixed;top:0;left:0}</style>
      <button id="outside">Outside</button><main><h1>Reading fixture</h1>
      <p id="original">😀 She <em>took</em> her time, then took a seat.</p>
      <div id="custom">They <span>looked up</span> at the sky.</div>
      <div id="scroll"><p>Formal knowledge is used in indexing and retrieval.</p><div style="height:500px"></div></div>
      <p id="long">${'Some lengthy contextual writing. '.repeat(30)}</p>
      <p contenteditable="true" id="editor">private editable text</p>
      <p id="edge">near the edge</p></main>`}) : route.abort());
  await page.goto('http://127.0.0.1/reading-fixture');
  await page.addScriptTag({content: 'window.__name = value => value;'});
  await page.evaluate(() => {
    const fixture = {calls: [] as any[], mode: 'ready', saveMode: 'ready', pending: null as any,
      pendingSave: null as any, receive: null as any, speeches: [] as any[], cancelled: 0, voices: true};
    Object.assign(window, {fixture, chrome: {runtime: {
      onMessage: {addListener: (receive: any) => { fixture.receive = receive; }},
      sendMessage: async (message: any) => {
        fixture.calls.push(message);
        if (message.kind !== 'lookup') {
          if (fixture.saveMode === 'error') return {error: 'offline'};
          if (fixture.saveMode === 'pending') return new Promise(resolve => { fixture.pendingSave = resolve; });
          return {value: {savedLocally: true}};
        }
        if (fixture.mode === 'pending') return new Promise(resolve => { fixture.pending = resolve; });
        if (fixture.mode === 'error') throw new Error('offline');
        if (fixture.mode === 'running') return {value: {status: 'running'}};
        if (fixture.mode === 'unresolved') return {value: {status: 'unresolved'}};
        if (fixture.mode === 'long') return {value: {status: 'ready', proposal: {
          explanation: '在当前句子里，这个表达表示按照自己的节奏完成事情。'.repeat(50),
          semanticSpec: {coreMeaningFocus: '较长的补充说明。'.repeat(80), prototypeScenes: []}}}};
        return {value: {status: 'ready', proposal: {explanation: '这里表示从容地做事，不着急。',
          semanticSpec: {coreMeaningFocus: '不急于完成', prototypeScenes: [{summary: '按自己的节奏做事。'}]}}}};
      },
    }}});
    Object.defineProperty(window, 'speechSynthesis', {value: {
      getVoices: () => fixture.voices ? [{localService: true, lang: 'en-US'}] : [],
      speak: (value: any) => fixture.speeches.push(value), cancel: () => { fixture.cancelled++; },
    }});
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {value: class {constructor(public text: string) {}}});
  });
  await page.addScriptTag({path: resolve('apps/browser-extension/dist/content.js')});
  await page.evaluate(() => (window as any).fixture.receive({kind: 'reading', enabled: true, accountId: 'account-a'}));
  const cdp = await page.context().newCDPSession(page);
  async function panelObject() {
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    function find(node: any): any {
      if (node.nodeName === 'SECTION' && node.attributes?.includes('Sensa 阅读')) return node;
      for (const child of [...node.children ?? [], ...node.shadowRoots ?? []]) {
        const found = find(child); if (found) return found;
      }
    }
    const node = find(root);
    if (!node) return null;
    return (await cdp.send('DOM.resolveNode', {nodeId: node.nodeId})).object.objectId;
  }
  async function inspect(expression: string) {
    const objectId = await panelObject();
    expect(objectId).toBeTruthy();
    const response = await cdp.send('Runtime.callFunctionOn', {objectId: objectId!,
      functionDeclaration: `function(){return (${expression});}`, returnByValue: true});
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  const nodeExpr = (label: string) => `Array.from(this.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)})`;
  async function click(label: string) {
    const rect = await inspect(`(()=>{const b=${nodeExpr(label)};return b?.getBoundingClientRect().toJSON()})()`);
    expect(rect?.height, label).toBeGreaterThan(0);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }
  async function visible(label: string) {
    return inspect(`Boolean(${nodeExpr(label)}?.getBoundingClientRect().height)`);
  }
  async function select(selector = '#original em', text = 'took', occurrence = 0) {
    await page.mouse.move(2, 2);
    await page.evaluate(({selector, text, occurrence}) => {
      const node = document.querySelector(selector)!.firstChild!;
      let offset = -1;
      for (let i = 0; i <= occurrence; i++) offset = node.textContent!.indexOf(text, offset + 1);
      const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + text.length);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      document.dispatchEvent(new PointerEvent('pointerup', {button: 0}));
    }, {selector, text, occurrence});
    await expect.poll(panelObject).toBeTruthy();
  }
  const calls = () => page.evaluate(() => (window as any).fixture.calls);
  const set = (values: Record<string, unknown>) => page.evaluate(values => Object.assign((window as any).fixture, values), values);
  async function close() { await page.keyboard.press('Escape'); await expect.poll(panelObject).toBeFalsy(); }
  async function inViewport() {
    const rect = await inspect('this.getBoundingClientRect().toJSON()');
    const viewport = page.viewportSize()!;
    expect(rect.x).toBeGreaterThanOrEqual(7);
    expect(rect.y).toBeGreaterThanOrEqual(7);
    expect(rect.right).toBeLessThanOrEqual(viewport.width - 7);
    expect(rect.bottom).toBeLessThanOrEqual(viewport.height - 7);
  }

  await select();
  expect(await calls()).toHaveLength(0);
  expect(await visible('保存待处理')).toBe(false);
  expect(await inspect('this.getBoundingClientRect().height')).toBeLessThan(70);
  await page.screenshot({path: '/tmp/sensa-reading-toolbar.png'});
  await click('句中解释');
  await expect.poll(() => visible('保存到我的内容')).toBe(true);
  const first = (await calls())[0];
  expect(first.kind).toBe('lookup');
  captureSnapshotSchema.parse(first.snapshot);
  expect(first.snapshot.sentence).toBe('😀 She took her time, then took a seat.');
  expect(first.snapshot.expression).toEqual({text: 'took', start: 6, end: 10});
  expect(await inspect('this.querySelector("mark").textContent')).toBe('took');
  expect(await inspect('this.querySelector(".source").href')).toBe(first.snapshot.source.url);
  expect(await inspect('this.querySelector("details").open')).toBe(false);
  expect(await calls()).toHaveLength(1); // Understanding is neither saving nor learning.
  await page.screenshot({path: '/tmp/sensa-reading-explanation.png'});
  await click('保存到我的内容');
  await expect.poll(() => visible('保存到我的内容')).toBe(false);
  expect((await calls()).map((call: any) => call.kind)).toEqual(['lookup', 'accept']);
  expect((await calls())[1].lookupId).toBe(first.lookupId);
  await close();

  // Preview and save need no interpretation request; retries keep the same operation identity.
  await set({calls: [], saveMode: 'error'});
  await select('#custom span', 'looked up');
  await click('保存…');
  expect(await calls()).toHaveLength(0);
  await click('保存待处理');
  await expect.poll(() => inspect('this.querySelector(".feedback").textContent')).toContain('尚未完成');
  await set({saveMode: 'pending'});
  await click('保存待处理'); await click('保存待处理');
  expect(await calls()).toHaveLength(2);
  expect((await calls())[1].operationId).toBe((await calls())[0].operationId);
  expect((await calls())[0].snapshot.sentence).toBe('They looked up at the sky.');
  await page.evaluate(() => (window as any).fixture.pendingSave({value: {savedLocally: true}}));
  await expect.poll(() => visible('保存待处理')).toBe(false);
  await close();

  await set({calls: [], mode: 'pending', saveMode: 'ready'});
  await select(); await click('句中解释'); await click('句中解释');
  expect(await calls()).toHaveLength(1);
  await click('保存待处理');
  await page.evaluate(() => (window as any).fixture.pending({value: {status: 'ready', proposal: {
    explanation: '迟到解释', semanticSpec: {coreMeaningFocus: '固定意思', prototypeScenes: []}}}}));
  await expect.poll(() => inspect('this.querySelector(".explanation").textContent')).toBe('迟到解释');
  expect(await visible('保存到我的内容')).toBe(false); // No second save after saving during lookup.
  await close();

  for (const mode of ['error', 'running', 'unresolved']) {
    await set({calls: [], mode}); await select(); await click('句中解释');
    await expect.poll(() => inspect('this.querySelector(".explanation").getAttribute("aria-busy")')).toBeNull();
    expect(await visible('保存到我的内容')).toBe(false);
    expect(await visible('保存待处理')).toBe(true);
    if (mode !== 'unresolved') {
      await set({mode: 'ready'}); await click('检查解释结果');
      await expect.poll(() => visible('保存到我的内容')).toBe(true);
      expect((await calls())[0].lookupId).toBe((await calls())[1].lookupId);
    }
    await close();
  }

  // Account switch dismisses the old surface; a late result cannot appear in the new one.
  await set({calls: [], mode: 'pending'}); await select(); await click('句中解释');
  await page.evaluate(() => (window as any).fixture.receive({kind: 'reading', enabled: true, accountId: 'account-b'}));
  await expect.poll(panelObject).toBeFalsy();
  await set({mode: 'ready'}); await select();
  await page.evaluate(() => (window as any).fixture.pending({value: {status: 'ready', proposal: {
    explanation: 'OLD ACCOUNT', semanticSpec: {coreMeaningFocus: 'old', prototypeScenes: []}}}}));
  expect(await inspect('this.textContent')).not.toContain('OLD ACCOUNT');
  await click('句中解释');
  expect((await calls()).at(-1).accountId).toBe('account-b');
  await close();

  // Local pronunciation, stopping on dismiss, and explicit unavailable state.
  await set({calls: [], voices: true}); await select(); await click('朗读');
  expect(await page.evaluate(() => (window as any).fixture.speeches.at(-1).text)).toBe('took');
  expect(await calls()).toHaveLength(0);
  await click('停止朗读');
  expect(await page.evaluate(() => (window as any).fixture.cancelled)).toBe(1);
  await click('朗读'); await close();
  expect(await page.evaluate(() => (window as any).fixture.cancelled)).toBe(2);
  await set({voices: false}); await select(); await click('朗读');
  expect(await inspect('this.textContent')).toContain('没有可用的本机英语语音'); await close();

  // Real drag and keyboard movement remain bounded after a window resize.
  await select(); await click('句中解释');
  const before = await inspect('this.getBoundingClientRect().toJSON()');
  const handle = await inspect('this.querySelector(".drag").getBoundingClientRect().toJSON()');
  await page.mouse.move(handle.x + 30, handle.y + 20); await page.mouse.down();
  await page.mouse.move(handle.x + 180, handle.y + 110, {steps: 5}); await page.mouse.up();
  const after = await inspect('this.getBoundingClientRect().toJSON()');
  expect(after.x - before.x).toBeGreaterThan(100);
  await inspect('(this.querySelector(".drag").focus(), true)');
  await page.keyboard.press('ArrowLeft');
  expect((await inspect('this.getBoundingClientRect().x'))).toBe(after.x - 16);
  await page.setViewportSize({width: 320, height: 420});
  await expect.poll(async () => (await inspect('this.getBoundingClientRect().right'))).toBeLessThanOrEqual(313);
  await inViewport();
  await page.screenshot({path: '/tmp/sensa-reading-narrow.png'});
  await close();
  await select('#edge', 'edge'); await inViewport(); await click('句中解释'); await inViewport(); await close();
  await page.setViewportSize({width: 1100, height: 760});
  await select('#scroll p', 'indexing');
  await page.evaluate(() => { document.querySelector('#scroll')!.scrollTop = 400; });
  await expect.poll(panelObject).toBeFalsy();

  // Keyboard-only selection activates the toolbar and leaves a usable focus target.
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#original em')!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keyup', {key: 'Shift'}));
  });
  await expect.poll(panelObject).toBeTruthy();
  expect(await inspect('this.getRootNode().activeElement.textContent')).toBe('句中解释');
  await page.keyboard.press('Enter'); await expect.poll(() => visible('保存到我的内容')).toBe(true); await close();
  await set({mode: 'long'}); await select(); await click('句中解释');
  await expect.poll(() => visible('保存到我的内容')).toBe(true);
  await inViewport();
  expect(await inspect('this.scrollHeight > this.clientHeight')).toBe(true);
  const scrollPanel = await inspect('this.getBoundingClientRect().toJSON()');
  await page.mouse.move(scrollPanel.x + scrollPanel.width / 2, scrollPanel.y + scrollPanel.height / 2);
  await page.mouse.wheel(0, 450);
  await expect.poll(() => inspect('this.scrollTop')).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await close();
  // Editing fields are not reading input.
  await page.evaluate(() => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('#editor')!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerup', {button: 0}));
  });
  await page.waitForTimeout(100); expect(await panelObject()).toBeNull();
  // Rich article text, adjacent paragraphs and explicit context changes keep the target occurrence.
  await page.evaluate(()=>{document.querySelector('main')!.insertAdjacentHTML('afterbegin','<article id="article"><p id="rich">Before the trip. She <a href="#">took</a><span hidden>PRIVATE HIDDEN</span><strong> her time</strong>.<br>Then she left.</p><p id="cross">Another paragraph follows.</p></article>');});
  await set({calls:[],mode:'pending'});await select('#rich a','took');await click('句中解释');
  const narrow=(await calls()).at(-1);expect(narrow.snapshot.sentence).toContain('She took her time.');expect(narrow.snapshot.sentence).not.toContain('PRIVATE');
  await click('扩展上下文');expect(await visible('保存到我的内容')).toBe(false);
  await page.evaluate(()=>(window as any).fixture.pending({value:{status:'ready',proposal:{explanation:'OLD CONTEXT RESULT',semanticSpec:{coreMeaningFocus:'old',prototypeScenes:[]}}}}));
  await page.waitForTimeout(60);expect(await inspect('this.textContent')).not.toContain('OLD CONTEXT RESULT');
  await set({mode:'ready'});await click('句中解释');
  const wide=(await calls()).at(-1);expect(wide.lookupId).not.toBe(narrow.lookupId);expect(wide.snapshot.sentence).toContain('Before the trip.');expect(wide.snapshot.sentence).toContain('\nThen she left.');
  expect(captureSnapshotSchema.safeParse(wide.snapshot).success).toBe(true);
  await click('收起');expect(await visible('保存待处理')).toBe(false);await click('保存…');expect(await visible('保存到我的内容')).toBe(true);await close();
  await set({calls:[]});
  await page.evaluate(()=>{const range=document.createRange();range.setStart(document.querySelector('#rich strong')!.firstChild!,1);range.setEnd(document.querySelector('#cross')!.firstChild!,7);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{button:0}));});
  await expect.poll(panelObject).toBeTruthy();await click('句中解释');
  const crossed=(await calls()).at(-1).snapshot;expect(crossed.expression.text).toContain('her time.');expect(crossed.expression.text).toContain('\nAnother');expect(captureSnapshotSchema.safeParse(crossed).success).toBe(true);await close();
  // Streaming UI shows actual partial text, clears it on failure and isolates a closed panel.
  await page.evaluate(()=>{const fixture=(window as any).fixture;fixture.streams=[];(window as any).chrome.runtime.connect=()=>{let receive:any;const item={send:(value:any)=>receive(value),closed:false};fixture.streams.push(item);return {onMessage:{addListener:(fn:any)=>receive=fn},onDisconnect:{addListener:()=>{}},postMessage:(payload:any)=>{if(payload.input)Object.assign(item,{payload});},disconnect:()=>{item.closed=true;}};};});
  await select('#rich a','took');await click('句中解释');
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'partial',text:'未完成的解释'}));
  expect(await inspect('this.textContent')).toContain('未完成的解释');expect(await visible('保存到我的内容')).toBe(false);
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'result',value:{status:'unresolved',proposal:null}}));
  expect(await inspect('this.textContent')).not.toContain('未完成的解释');expect(await visible('保存到我的内容')).toBe(false);await close();
  await select('#rich a','took');await click('句中解释');
  const failedLookup=await page.evaluate(()=>(window as any).fixture.streams.at(-1).payload.input.id);
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'result',value:{status:'failed',proposal:null}}));
  expect(await visible('重新解释')).toBe(true);await click('重新解释');
  expect(await page.evaluate(()=>(window as any).fixture.streams.at(-1).payload.input.id)).not.toBe(failedLookup);await close();
  await select('#rich a','took');await click('翻译');
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'partial',text:'真实分片'}));
  expect(await inspect('this.textContent')).toContain('真实分片');expect(await visible('保存到我的内容')).toBe(false);
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'error',error:'reading_interrupted'}));
  expect(await inspect('this.textContent')).not.toContain('真实分片');expect(await inspect('this.textContent')).toContain('连接已中断');
  await click('翻译');await close();expect(await page.evaluate(()=>(window as any).fixture.streams.at(-1).closed)).toBe(true);
  await page.evaluate(()=>(window as any).fixture.streams.at(-1).send({type:'partial',text:'LATE STREAM'}));expect(await panelObject()).toBeNull();
  console.log('PASS: explicit lookup, Unicode/context/source, preview/save/accept, retries and idempotency, late results, account switch, local speech, drag/resize/edge/scroll, keyboard and editable guard; no network/provider calls.');
} finally { await browser.close(); }
