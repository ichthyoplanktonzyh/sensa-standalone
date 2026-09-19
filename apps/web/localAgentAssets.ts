import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

const sourceDirectory = fileURLToPath(new URL('../../integrations/codex/sensa-intake/', import.meta.url));
const executable = fileURLToPath(new URL('../../packages/mcp-server/src/index.ts', import.meta.url));
const staticAssets = [
  { name: 'SKILL.md', type: 'text/markdown; charset=utf-8' },
  { name: 'request-example.json', type: 'application/json; charset=utf-8' },
] as const;

let bundled: Promise<Uint8Array> | undefined;
function mcpBundle(): Promise<Uint8Array> {
  bundled ??= build({
    entryPoints: [executable],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
  }).then((result) => result.outputFiles[0]!.contents);
  return bundled;
}

/** Ships the reviewed MCP/CLI adapter and Codex guidance beside the Web release. */
export function localAgentAssets(): Plugin {
  return {
    name: 'sensa-agent-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/integrations/sensa-mcp.mjs') {
          void mcpBundle().then(
            (bytes) => {
              response.statusCode = 200;
              response.setHeader('content-type', 'text/javascript; charset=utf-8');
              response.setHeader('cache-control', 'no-store');
              response.end(bytes);
            },
            next,
          );
          return;
        }
        const asset = staticAssets.find(({ name }) => request.url === `/integrations/${name}`);
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
      this.emitFile({
        type: 'asset',
        fileName: 'integrations/sensa-mcp.mjs',
        source: await mcpBundle(),
      });
      for (const asset of staticAssets) {
        this.emitFile({
          type: 'asset',
          fileName: `integrations/${asset.name}`,
          source: await readFile(join(sourceDirectory, asset.name)),
        });
      }
    },
  };
}
