import { Hono } from 'hono';
import { cors } from 'hono/cors';
// Build workspace packages/API first. Node and Edge execute the same compiled application.
import { createConsumerRoutes } from '../../../apps/api/dist/sensa/access/consumer.js';
import { sensaCorsOptions } from '../../../apps/api/dist/sensa/access/cors.js';
const app = new Hono();
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s=>s.trim()).filter(Boolean);
app.use('*', cors(sensaCorsOptions(origins)));
app.route('',createConsumerRoutes({browserTelemetryOrigins:origins}));
Deno.serve(request => {
  const url=new URL(request.url);
  url.pathname=url.pathname.replace(/^\/functions\/v1\/sensa-api(?=\/|$)/u,'').replace(/^\/sensa-api(?=\/|$)/u,'')||'/';
  return app.fetch(new Request(url,request));
});
