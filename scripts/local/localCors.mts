import {sensaCorsOptions} from '../../apps/api/src/sensa/access/cors.ts';

/** Explicit test/development extension origins, never all installed extensions. */
export function localExtensionOrigins(raw:string|undefined):string[]{
 const origins=(raw??'').split(',').map(value=>value.trim()).filter(Boolean);
 if(origins.some(origin=>!/^chrome-extension:\/\/[a-p]{32}$/u.test(origin)))throw new Error('Local extension origins must be explicit Chrome extension origins');
 return [...new Set(origins)];
}

/** Production consumer policy plus the local Supabase-compatible Auth headers. */
export const localSensaCorsOptions=(origins:readonly string[])=>{
 const consumer=sensaCorsOptions([...origins]);
 return {...consumer,allowHeaders:[...consumer.allowHeaders!,'apikey','x-client-info','x-supabase-api-version']};
};
