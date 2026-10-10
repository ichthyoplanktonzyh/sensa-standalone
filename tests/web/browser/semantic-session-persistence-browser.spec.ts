/** Real-browser proof that a rejected clarification-session write stays visible
 * and is never presented as durably saved across reload. */
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {build} from 'esbuild';
import {expect, test} from '@playwright/test';

let server: Server;
let port: number;

test.setTimeout(60_000);

test.beforeAll(async () => {
  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import i18n from './apps/web/src/i18n';
import {
  loadSemanticAgentSession,
  newSemanticAgentSession,
  saveSemanticAgentSession,
} from './apps/web/src/experience/personalMeaningJourney/semanticAgentSession';
import {PersonalMeaningDetailScreen} from './apps/web/src/experience/components/PersonalMeaningDetailScreen';

const personalMeaningId = '11111111-1111-4111-8111-111111111111';
const threadId = '22222222-2222-4222-8222-222222222222';
const loaded = loadSemanticAgentSession(personalMeaningId, () => threadId);
if (loaded.persistence === 'new') {
  (window as Window & {__allowSemanticSessionWrite?: boolean}).__allowSemanticSessionWrite = true;
  const session = newSemanticAgentSession(personalMeaningId, threadId);
  session.languageContext = {targetLanguageTag: 'en', supportLanguageTag: 'zh-CN'};
  session.messages = [
    {messageId: crypto.randomUUID(), role: 'assistant', body: 'What situation do you want to clarify?', occurredAt: new Date().toISOString()},
  ];
  await saveSemanticAgentSession(session);
  (window as Window & {__allowSemanticSessionWrite?: boolean}).__allowSemanticSessionWrite = false;
}

await i18n.changeLanguage('en');
createRoot(document.getElementById('root')!).render(<PersonalMeaningDetailScreen
  active
  personalMeaningId={personalMeaningId}
  onBack={() => {}}
  onOpenConfirmedSense={() => {}}
  toast={() => {}}
/>);
`,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    loader: {'.css': 'text'},
    define: {'import.meta.env': '{}'},
    plugins: [{
      name: 'fixture-personal-meaning-journey',
      setup(build) {
        build.onLoad({filter:/personalMeaningJourney.*mediaStore\.ts$/},()=>({loader:'ts',contents:`
export const useMediaStoreVersion=()=>0;
export const getMedia=()=>null;
export class MediaStoreFullError extends Error {}
export const removeMedia=async()=>{};
export const storeImageFile=async()=>{throw new Error('controlled unsupported image write');};
export const stageMedia=()=>{throw new Error('localFlow.imageRead');};
`}));
        build.onLoad({filter: /personalMeaningJourney.*index\.ts$/}, () => ({
          loader: 'ts',
          contents: `
const draft = {
  intakeId: '11111111-1111-4111-8111-111111111111',
  context: null,
  materialBlocks: [{kind: 'text', bodyText: 'Protected learner input'}],
  familiarExpression: null,
  startingPoint: null,
};
const gateway = {
  addMaterialBlock: async () => {}, addClarificationMaterial: async () => {},
  reviseContext: async () => {}, confirmClarification: async () => ({}),
  completeClarificationDraft: async () => ({}), confirmExpressionBinding: async () => ({}),
};
export const useJourneyGateway = () => gateway;
export const createJourneyGateway = () => ({lookupMeanings:async()=>({meanings:[],truncated:false})});
const source={kind:'intake',id:draft.intakeId,incarnation:'controlled-session-fixture',digest:'0'.repeat(64)};
export const useJourneyDetail = () => ({detail: null,draft,source,status:{ok:true},readCurrent:async()=>({detail:null,draft,source}),reload:()=>{}});
export const useJourneyClarificationDraft = (id) => id ? draft : null;
`,
        }));
        build.onLoad({filter: /realSemanticAgent\.ts$/}, () => ({
          loader: 'ts',
          contents: `
export const createRealSemanticAgent = () => ({
  turn: async (input) => {
    input.onAssistantText?.('Your input is still in this tab.');
    return {
      assistantMessage: 'Your input is still in this tab.',
      workingSet: input.workingSet,
      readyToConfirm: false,
      provenance: {provider: 'fixture', model: 'fixture', promptVersion: 'fixture'},
      steps: [],
    };
  },
});
`,
        }));
      },
    }],
  });
  const code = compiled.outputFiles[0]!.text;
  server = createServer((request, response) => {
    response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js'
      ? code
      : '<!doctype html><html lang="en"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as {port: number}).port;
});

test.afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('failed persistence keeps input and warning through reload until retry succeeds', async ({page}) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.addInitScript(() => {
    const surface = window as Window & {__allowSemanticSessionWrite?: boolean};
    surface.__allowSemanticSessionWrite = false;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      if (
        this === window.localStorage
        && key.includes('sensa_semantic_agent_session_v3:')
        && !surface.__allowSemanticSessionWrite
      ) {
        throw new DOMException('fixture quota full', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    };
  });
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue()
    : route.abort());

  await page.goto(`http://127.0.0.1:${port}`);
  const input = page.getByLabel('What would you like to express?');
  await input.fill('Protected learner input');
  await page.getByRole('button', {name: 'Send'}).click();
  await expect(input).toHaveValue('');
  await expect(page.getByText('Protected learner input', {exact: true})).toBeVisible();
  await expect(page.locator('[data-session-persistence="tab-only"]')).toContainText('Could not save locally');

  await page.reload();
  await expect(page.getByText('Protected learner input', {exact: true})).toBeVisible();
  await expect(page.locator('[data-session-persistence="tab-only"]')).toBeVisible();

  await page.evaluate(() => {
    (window as Window & {__allowSemanticSessionWrite?: boolean}).__allowSemanticSessionWrite = true;
  });
  await page.getByRole('button', {name: 'Retry'}).click();
  await expect(page.locator('[data-session-persistence="tab-only"]')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('Protected learner input', {exact: true})).toBeVisible();
  await expect(page.locator('[data-session-persistence="tab-only"]')).toHaveCount(0);
  assert.deepEqual(runtimeErrors, []);
});

test('rejected image staging keeps the input and photo available without leaving the conversation busy',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${port}`);
 const input=page.getByLabel('What would you like to express?');await expect(input).toBeVisible();
 await input.fill('Preserve my input when the photo cannot be staged');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=','base64');
 await page.locator('form').filter({has:input}).getByLabel('Add images',{exact:true}).setInputFiles({name:'synthetic-stage-failure.png',mimeType:'image/png',buffer:png});
 const image=page.getByRole('img',{name:'synthetic-stage-failure.png',exact:true});await expect(image).toBeVisible();
 const prepared=await image.getAttribute('src');await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();await expect(input).toBeEnabled();await expect(input).toHaveValue('Preserve my input when the photo cannot be staged');
 await expect(image).toHaveAttribute('src',prepared!);await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await expect(page.getByText('Your input is still in this tab.',{exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});

test('a stale tab preserves its input and must load the latest revision before continuing', async ({context, page}) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const stalePage = await context.newPage();
  stalePage.on('pageerror', (error) => runtimeErrors.push(error.message));
  for (const target of [page, stalePage]) {
    await target.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue()
      : route.abort());
    await target.goto(`http://127.0.0.1:${port}`);
    await expect(target.getByLabel('What would you like to express?')).toBeVisible();
  }

  const firstInput = page.getByLabel('What would you like to express?');
  await firstInput.fill('Saved by the first tab');
  await page.getByRole('button', {name: 'Send'}).click();
  await expect(firstInput).toHaveValue('');
  await expect(page.getByText('Saved by the first tab', {exact: true})).toBeVisible();
  await expect(page.getByText('Your input is still in this tab.', {exact: true})).toBeVisible();

  const staleInput = stalePage.getByLabel('What would you like to express?');
  await staleInput.fill('Protected stale-tab input');
  await stalePage.getByRole('button', {name: 'Send'}).click();
  await expect(staleInput).toHaveValue('Protected stale-tab input');
  await expect(stalePage.locator('.pmw-message').getByText('Protected stale-tab input', {exact: true})).toBeVisible();
  const conflict = stalePage.locator('[data-session-persistence="conflict"]');
  await expect(conflict).toContainText('changed in another tab');
  await expect(stalePage.getByText('Saved by the first tab', {exact: true})).toHaveCount(0);

  await conflict.getByRole('button').click();
  await expect(conflict).toHaveCount(0);
  await expect(stalePage.getByText('Saved by the first tab', {exact: true})).toBeVisible();
  await expect(stalePage.locator('.pmw-message').getByText('Protected stale-tab input', {exact: true})).toHaveCount(0);
  await expect(staleInput).toHaveValue('Protected stale-tab input');

  await stalePage.reload();
  await expect(stalePage.getByText('Saved by the first tab', {exact: true})).toBeVisible();
  await expect(stalePage.locator('.pmw-message').getByText('Protected stale-tab input', {exact: true})).toHaveCount(0);
  await expect(stalePage.locator('[data-session-persistence="conflict"]')).toHaveCount(0);
  assert.deepEqual(runtimeErrors, []);
});
