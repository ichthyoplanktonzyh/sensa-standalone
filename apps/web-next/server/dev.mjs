import { createServer as createViteServer } from 'vite';
import { startSemanticAgentServer } from './semantic-agent-server.mjs';

const agent = await startSemanticAgentServer();
const vite = await createViteServer({
  server: { host: 'localhost', port: 5174, strictPort: true },
});

await vite.listen();
vite.printUrls();

const shutdown = async () => {
  await vite.close();
  await new Promise((resolve) => agent.close(resolve));
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
