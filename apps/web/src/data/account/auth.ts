import {createClient} from '@supabase/supabase-js';

const projectUrl=import.meta.env.VITE_SUPABASE_URL as string|undefined;
const publicKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;

// Preserve the SDK's existing storage key; this read never authorizes online requests.
export const authStorageKey=projectUrl?`sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`:undefined;

export function cachedAuthSubject():string|null|undefined {
  if(!authStorageKey)return null;
  try {
    const raw=localStorage.getItem(authStorageKey);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return typeof parsed?.user?.id==='string'?parsed.user.id:undefined;
  }catch{return undefined;}
}

export const auth=projectUrl&&publicKey?createClient(projectUrl,publicKey,{auth:{storageKey:authStorageKey,flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}).auth:null;
