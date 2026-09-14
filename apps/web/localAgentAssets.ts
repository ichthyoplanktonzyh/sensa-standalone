import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const sourceDirectory = fileURLToPath(new URL('../../integrations/codex/sensa-intake/', import.meta.url));
const assets = [
  { name: 'sensa-intake.mjs', type: 'text/javascript; charset=utf-8' },
  { name: 'SKILL.md', type: 'text/markdown; charset=utf-8' },
  { name: 'request-example.json', type: 'application/json; charset=utf-8' },
] as const;

/** Ships the exact reviewed CLI and Codex skill beside the Web release. */
export function localAgentAssets(): Plugin {
  return {
    name: 'sensa-local-agent-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.find(({ name }) => request.url === `/integrations/${name}`);
        if (!asset) { next(); return; }
        void readFile(join(sourceDirectory, asset.name)).then(
          (bytes) => {
            response.statusCode = 200;
            response.setHeader('content-type', asset.type);
            response.setHeader('cache-control', 'no-store');
            response.end(bytes);
          },
          next,
        );
      });
    },
    async generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: `integrations/${asset.name}`,
          source: await readFile(join(sourceDirectory, asset.name)),
        });
      }
    },
  };
}
