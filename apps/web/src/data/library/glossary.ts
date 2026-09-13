import {sensaReadingGlossarySchema,type SensaReadingGlossary} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction} from './store';

/** One key, one glossary. Which words a learner wants to read is learner state,
 * not a device setting: it rides the same settings table as the language profile,
 * so it syncs with the account and the reading surfaces of every installation
 * read the same one. */
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
export function setReadingGlossaryEntry(operationId:string,term:string,rendering:string){
 return command({id:operationId,kind:'reading.setGlossaryEntry',input:{term,rendering}},async tx=>{
  const current=await readReadingGlossary(tx),listed=current.findIndex(entry=>entry.term.toLowerCase()===term.toLowerCase());
  const next=sensaReadingGlossarySchema.parse(listed<0?[...current,{term,rendering}]:current.map((entry,index)=>index===listed?{term,rendering}:entry));
  return writeReadingGlossary(tx,next);
 });
}

export function removeReadingGlossaryEntry(operationId:string,term:string){
 return command({id:operationId,kind:'reading.removeGlossaryEntry',input:{term}},async tx=>{
  const current=await readReadingGlossary(tx);
  // Matched the way it is written, so a term the learner capitalised differently
  // is still the term they are removing.
  const next=current.filter(entry=>entry.term.toLowerCase()!==term.toLowerCase());
  if(next.length===current.length)return current;
  return writeReadingGlossary(tx,next);
 });
}
