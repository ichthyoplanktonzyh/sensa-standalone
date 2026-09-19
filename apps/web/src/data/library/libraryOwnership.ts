import type {LibraryIdentity,LibraryTransaction} from './store';

/** Require the locally admitted account without loading package validation. */
export async function learningOwner(tx:LibraryTransaction):Promise<LibraryIdentity>{
 const identity=await tx.get<LibraryIdentity>('meta','identity');
 if(!identity||!await tx.get('meta','service-owner')||await tx.get('meta','signed-out'))throw new Error('localFlow.originalAccount');
 return identity;
}
