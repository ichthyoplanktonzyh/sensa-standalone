import {createClient} from '@supabase/supabase-js';
import {authStorageKey} from './authSessionHint';
export {authStorageKey,cachedAuthSubject} from './authSessionHint';

const projectUrl=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const publicKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;

export const auth=projectUrl&&publicKey?createClient(projectUrl,publicKey,{auth:{storageKey:authStorageKey,flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}).auth:null;
