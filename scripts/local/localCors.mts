import {sensaCorsOptions} from '../../apps/api/src/sensa/access/cors.ts';

/** Production consumer policy plus the local Supabase-compatible Auth headers. */
export const localSensaCorsOptions=(origins:readonly string[])=>{
 const consumer=sensaCorsOptions([...origins]);
 return {...consumer,allowHeaders:[...consumer.allowHeaders!,'apikey','x-client-info','x-supabase-api-version']};
};
