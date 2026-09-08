import {chromium,expect} from '@playwright/test';
import {build} from 'esbuild';
import {captureSnapshotSchema} from '@sensa/contracts/sensa';
if(!process.argv.includes('--live-sites'))throw new Error('Pass --live-sites for read-only public site checks; no provider calls.');
const bundled=await build({entryPoints:['apps/browser-extension/src/selection.ts'],bundle:true,write:false,format:'iife',globalName:'SensaSelectionCheck',target:'chrome120'});
const browser=await chromium.launch({executablePath:process.env.SENSA_CHROMIUM_PATH});
try{
  const page=await browser.newPage({viewport:{width:1200,height:850}});
  await page.addInitScript({content:bundled.outputFiles[0].text+';globalThis.SensaSelectionCheck=SensaSelectionCheck;'});
  for(const url of ['https://developer.mozilla.org/en-US/docs/Web/CSS/display','https://en.wikipedia.org/wiki/Language_acquisition']){
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    const samples=await page.evaluate(()=>{
      const output:any[]=[];
      for(const paragraph of document.querySelectorAll('main p,article p,.mw-parser-output p')){
        if(output.length===4)break;
        if(!paragraph.getClientRects().length||(paragraph.textContent?.length??0)<80)continue;
        const walker=document.createTreeWalker(paragraph,NodeFilter.SHOW_TEXT);let node:Node|null;
        while((node=walker.nextNode())){
          const match=node.textContent?.match(/[a-zA-Z]{4,}/u);if(!match)continue;
          const range=document.createRange();range.setStart(node,match.index!);range.setEnd(node,match.index!+match[0].length);
          const snapshot=(window as any).SensaSelectionCheck.captureSelection(range);
          if(snapshot){output.push(snapshot);break;}
        }
      }
      return output;
    });
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for(const snapshot of samples){expect(captureSnapshotSchema.safeParse(snapshot).success).toBe(true);expect(snapshot.source.url).toBe(page.url());expect(snapshot.expression).toBeTruthy();}
    console.log(`PASS: ${new URL(page.url()).hostname}: ${samples.length} visible article context/expression captures against current public DOM.`);
  }
}finally{await browser.close();}
