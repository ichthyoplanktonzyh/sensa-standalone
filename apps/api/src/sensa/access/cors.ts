import type {cors} from 'hono/cors';

type CorsOptions=NonNullable<Parameters<typeof cors>[0]>;

export const sensaCorsOptions=(origin:CorsOptions['origin'],credentials=false):CorsOptions=>({
  origin,
  allowMethods:['GET','POST','OPTIONS'],
  allowHeaders:['authorization','content-type','if-none-match','x-client-platform','x-client-version','x-installation-id'],
  exposeHeaders:['x-request-id'],
  ...(credentials?{credentials:true}:{}),
});
