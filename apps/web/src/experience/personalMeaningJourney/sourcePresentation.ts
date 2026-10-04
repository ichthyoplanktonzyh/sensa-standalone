import type {SensaIntakeContext} from '@sensa/contracts/sensa';
const clients=new Map([['codex','Codex'],['cursor','Cursor'],['claude_desktop','Claude Desktop'],['windsurf','Windsurf'],['sensa-web','Sensa'],['sensa-browser-extension','Sensa']]);
export function intakeSourceLabel(source:NonNullable<SensaIntakeContext['source']>):string{
  const client=clients.get(source.client)??source.client,title=source.title??source.url;
  return title?`${client} · ${title}`:client;
}
export function intakeSourceUrl(source:NonNullable<SensaIntakeContext['source']>):string|null{
  if(!source.url)return null;
  try{const url=new URL(source.url);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
