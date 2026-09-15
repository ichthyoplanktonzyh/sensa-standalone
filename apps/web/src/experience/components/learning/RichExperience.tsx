import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {SENSA_INTERACTIVE_HTML_TAGS,type SensaContextImage} from '@sensa/contracts/sensa';
import {localFlowText} from '../../../i18n/localFlowText';
const tags=new Set<string>(SENSA_INTERACTIVE_HTML_TAGS);
const attributes=new Set(['id','class','title','role','aria-label','aria-live','hidden','draggable','data-action','data-target','data-dropzone','data-state','type','min','max','step','value','checked']);
const css=new Set(['display','position','left','right','top','bottom','width','height','min-height','max-width','padding','margin','gap','border','border-radius','background','background-color','color','font-size','font-weight','text-align','align-items','justify-content','flex-direction','flex-wrap','grid-template-columns','cursor','transform','opacity']);
/** Reconstruct an allowlisted tree; author HTML has no executable capabilities. */
export function offlineInteractionDocument(html:string){
 const source=new DOMParser().parseFromString(html,'text/html'),target=document.implementation.createHTMLDocument('');
 const copy=(node:Node,parent:Node)=>{
  if(node.nodeType===Node.TEXT_NODE){parent.appendChild(target.createTextNode(node.textContent??''));return;}
  if(!(node instanceof Element)||!tags.has(node.localName))return;
  const el=target.createElement(node.localName);
  for(const a of node.attributes)if(attributes.has(a.name)&&(!['type'].includes(a.name)||['button','checkbox','range'].includes(a.value)))el.setAttribute(a.name,a.value);
  if(el.localName==='button')el.setAttribute('type','button');
  const original=(node as HTMLElement).style;
  if(original)for(const property of css){const value=original.getPropertyValue(property);if(value&&!/url|@|\\/iu.test(value))(el as HTMLElement).style.setProperty(property,value);}
  parent.appendChild(el);for(const child of node.childNodes)copy(child,el);
 };
 for(const node of source.body.childNodes)copy(node,target.body);
 const nonce=crypto.randomUUID().replaceAll('-','');
 const script=`document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const t=document.getElementById(b.dataset.target);if(!t)return;if(b.dataset.action==='toggle')t.hidden=!t.hidden;if(b.dataset.action==='increment')t.textContent=String((Number(t.textContent)||0)+1);});let moving=null,startX=0,startY=0;document.addEventListener('dragstart',e=>e.preventDefault());document.addEventListener('pointerdown',e=>{moving=e.target.closest('[draggable=true]');if(moving){startX=e.clientX;startY=e.clientY;moving.setPointerCapture(e.pointerId);e.preventDefault();}});document.addEventListener('pointermove',e=>{if(moving)moving.style.transform='translate('+(e.clientX-startX)+'px,'+(e.clientY-startY)+'px)';});document.addEventListener('pointerup',e=>{if(!moving)return;moving.style.pointerEvents='none';const z=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-dropzone]');moving.style.pointerEvents='';moving.style.transform='';if(z&&!moving.contains(z)){z.append(moving);z.dataset.state='dropped';}moving=null;});document.addEventListener('pointercancel',()=>{if(moving)moving.style.transform='';moving=null;});`;

 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';"><style>body{font:16px system-ui;margin:16px;color:#313c50;overflow-wrap:anywhere}button{min-height:44px;cursor:pointer}input{max-width:100%}[draggable=true]{touch-action:none;cursor:grab}[hidden]{display:none!important}</style></head><body>${target.body.innerHTML}<script nonce="${nonce}">${script}</script></body></html>`;
}
export function RichExperience({scene,images,html}:{scene:string;images?:readonly SensaContextImage[];html?:string}){
 useTranslation();const srcDoc=useMemo(()=>html?offlineInteractionDocument(html):undefined,[html]);
 return <div className="space-y-4">{scene&&<p className="whitespace-pre-wrap leading-8">{scene}</p>}{images?.map(image=><img key={image.id} src={image.dataUrl} alt={localFlowText('contextImage')} className="max-h-96 w-full rounded-control object-contain"/>)}{srcDoc&&<iframe title={localFlowText('interactiveExperience')} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcDoc} className="h-80 w-full rounded-control border border-border-subtle bg-surface-panel"/>}</div>;
}
