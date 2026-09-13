import {sensaReadingGlossarySchema,type SensaReadingGlossary} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction} from './store';

/** One learner-owned collection, with every entry scoped to its exact
 * Input/Output Language pair. It syncs with the account; reading surfaces
 * receive the collection but send only the active operation's pair. */
const GLOSSARY_KEY='reading-glossary';

/** A library with no glossary has none. Nothing is written until the learner
 * writes it, so an empty list and a list the learner emptied stay the same thing
 * they always were: no preference. */
export const readingGlossarySnapshot=()=>readLibrary(async tx=>{
 const stored=await tx.get<unknown>('settings',GLOSSARY_KEY);
 return {glossary:readGlossary(stored),saved:stored!==undefined};
});

/** A stored glossary is validated on the way out, not trusted: a release that
 * narrows the bounds must not keep feeding the reader entries it can no longer
 * send, and a value this release cannot read is no glossary rather than a crash. */
export function readGlossary(stored:unknown):SensaReadingGlossary{
 const parsed=sensaReadingGlossarySchema.safeParse(stored??[]);
 return parsed.success?parsed.data:[];
}

export async function readReadingGlossary(tx:LibraryTransaction):Promise<SensaReadingGlossary>{
 return readGlossary(await tx.get<unknown>('settings',GLOSSARY_KEY));
}

export async function writeReadingGlossary(tx:LibraryTransaction,glossary:SensaReadingGlossary){
 const parsed=sensaReadingGlossarySchema.parse(glossary);
 tx.put('settings',GLOSSARY_KEY,parsed);
 return parsed;
}

/** Adding a term the glossary already lists corrects its rendering in place: two
 * renderings for one word is not a preference the reader could honour, and a term
 * that jumped to the end of the list while being corrected would look like a
 * second entry. */
export function setReadingGlossaryEntry(operationId:string,inputLanguageTag:string,outputLanguageTag:string,term:string,rendering:string){
 return command({id:operationId,kind:'reading.setGlossaryEntry',input:{inputLanguageTag,outputLanguageTag,term,rendering}},async tx=>{
  const current=await readReadingGlossary(tx),listed=current.findIndex(entry=>entry.inputLanguageTag===inputLanguageTag&&entry.outputLanguageTag===outputLanguageTag&&entry.term.toLocaleLowerCase(inputLanguageTag)===term.toLocaleLowerCase(inputLanguageTag));
  const value={inputLanguageTag,outputLanguageTag,term,rendering};
  const next=sensaReadingGlossarySchema.parse(listed<0?[...current,value]:current.map((entry,index)=>index===listed?value:entry));
  return writeReadingGlossary(tx,next);
 });
}

export function removeReadingGlossaryEntry(operationId:string,inputLanguageTag:string,outputLanguageTag:string,term:string){
 return command({id:operationId,kind:'reading.removeGlossaryEntry',input:{inputLanguageTag,outputLanguageTag,term}},async tx=>{
  const current=await readReadingGlossary(tx);
  const next=current.filter(entry=>entry.inputLanguageTag!==inputLanguageTag||entry.outputLanguageTag!==outputLanguageTag||entry.term.toLocaleLowerCase(inputLanguageTag)!==term.toLocaleLowerCase(inputLanguageTag));
  if(next.length===current.length)return current;
  return writeReadingGlossary(tx,next);
 });
}
