import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { readSensaApiEnvironment } from "./server/environment.js";

const port = readSensaApiEnvironment().PORT;

serve({ fetch: app.fetch, port });
console.log(`Sensa standalone API listening on http://127.0.0.1:${port}`);
