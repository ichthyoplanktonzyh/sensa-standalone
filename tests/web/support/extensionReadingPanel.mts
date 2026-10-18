import type {Page} from '@playwright/test';
export type ExtensionPanelUi={buttons:Array<{label:string;x:number;y:number}>;feedback:string;explanation:string;assistance:string;explanationBusy:boolean;assistanceBusy:boolean};
/** Read the real closed-shadow surface, then use ordinary pointer input.
 * Button positions are presentation, not a contract frozen into every journey. */
export async function extensionPanelUi(page:Page):Promise<ExtensionPanelUi|null>{
 const cdp=await page.context().newCDPSession(page);
 try{
  // A changed selection can replace the closed-shadow host between CDP reads.
  for(let attempt=0;attempt<3;attempt++){
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  const find=(node:typeof root):typeof root|undefined=>{
   if(node.nodeName==='SECTION'&&node.attributes?.some(value=>value==='Sensa 阅读'||value==='Sensa reading'))return node;
   for(const child of [...node.children??[],...node.shadowRoots??[]]){const found=find(child);if(found)return found;}
  };
  const panel=find(root);if(!panel)return null;
  let object:string;
  try{object=(await cdp.send('DOM.resolveNode',{nodeId:panel.nodeId})).object.objectId!;}
  catch(cause){if(cause instanceof Error&&cause.message.includes('Protocol error (DOM.resolveNode): No node with given id found'))continue;throw cause;}
  const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object,functionDeclaration:'function(){const visibleText=e=>e&&e.getClientRects().length?e.textContent:"";const explanation=this.querySelector(".explanation"),assistance=this.querySelector(".body > p[role=status]:not(.explanation):not(.feedback)");return {buttons:Array.from(this.querySelectorAll("button")).filter(b=>!b.disabled&&b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return {label:b.textContent,x:r.x+r.width/2,y:r.y+r.height/2};}),feedback:Array.from(this.querySelectorAll(".feedback")).map(visibleText).join(" "),explanation:visibleText(explanation),assistance:visibleText(assistance),explanationBusy:explanation?.getAttribute("aria-busy")==="true",assistanceBusy:assistance?.getAttribute("aria-busy")==="true"};}',returnByValue:true});
  return result.value;
  }
  return null;
 }finally{await cdp.detach();}
}
export async function extensionPanelButton(page:Page,label:string,click=false):Promise<boolean>{
 const button=(await extensionPanelUi(page))?.buttons.find(button=>button.label===label);
 if(!button)return false;if(click)await page.mouse.click(button.x,button.y);return true;
}
