import {readLibrary,type LibraryTransaction} from '../library/store';

export const accountSignoutEpochKey='service-signout-epoch';
export const readAccountSignoutEpoch=(tx:LibraryTransaction)=>tx.get<string>('meta',accountSignoutEpochKey).then(value=>value??null);
export const accountSignoutEpoch=()=>readLibrary(readAccountSignoutEpoch);
export type AccountSessionBoundary={subject:string;accountId:string|null;epoch:string|null};

/** Local logout invalidates pending online work without closing the data library. */
export async function captureAccountSessionBoundary(subject:string):Promise<AccountSessionBoundary>{
 return readLibrary(async tx=>{
  const owner=await tx.get<{subject:string;accountId?:string}>('meta','service-owner');
  if(!subject||!owner||await tx.get('meta','signed-out'))throw Error('authentication_required');
  if(owner.subject!==subject)throw Error('account_changed');
  return {subject,accountId:owner.accountId??null,epoch:await readAccountSignoutEpoch(tx)};
 });
}
export async function assertAccountSessionBoundary(expected:AccountSessionBoundary){
 const current=await captureAccountSessionBoundary(expected.subject);
 if(current.accountId!==expected.accountId||current.epoch!==expected.epoch)throw Error('account_changed');
}
