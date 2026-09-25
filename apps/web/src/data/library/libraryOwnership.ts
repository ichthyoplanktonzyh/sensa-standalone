import type {LibraryIdentity,LibraryTransaction} from './store';

/** Learning belongs to the local library, whether or not an account is connected. */
export async function learningOwner(tx:LibraryTransaction):Promise<LibraryIdentity>{
 const identity=await tx.get<LibraryIdentity>('meta','identity');
 if(!identity)throw new Error('localFlow.storageOpen');
 return identity;
}
