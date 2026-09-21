import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {offlineShell} from './offlineShell';
import {localAgentAssets} from './localAgentAssets';
import {resolve} from 'node:path';

export default defineConfig(({ mode }) => {
  const localAcceptance = mode === 'sensa-local';
  const envDirectory = localAcceptance ? '../../.sensa-local/env' : '.';
  const env = loadEnv(mode, envDirectory, "VITE_");
  const release = /^(?:development|[0-9a-f]{7,40})$/u.test(process.env.SENSA_RELEASE_SHA ?? '')
    ? process.env.SENSA_RELEASE_SHA
    : 'development';
  if (localAcceptance) {
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SENSA_API_URL'] as const) {
      const value = process.env[key] ?? env[key];
      let url: URL;
      try { url = new URL(value); } catch { throw new Error(`${key} must be an explicit loopback URL`); }
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        throw new Error(`${key} must remain on loopback in local acceptance mode`);
      }
    }
  }
  return {
    define: { __SENSA_RELEASE__: JSON.stringify(release) },
    envDir: envDirectory,
    publicDir: "public",
    plugins: [react(), tailwindcss(),localAgentAssets(),offlineShell()],
    build:{rollupOptions:{input:{index:resolve(__dirname,'index.html'),youglishPlayer:resolve(__dirname,'youglish-player.html')}}},
    server: {
      host: "127.0.0.1",
      port: Number(env.VITE_WEB_PORT ?? 3000),
      strictPort: true,
      proxy: { "/api/prototype/semantic-agent": "http://localhost:5175" },
    },
    preview: {
      host: "127.0.0.1",
      port: Number(env.VITE_WEB_PORT ?? 3000),
      strictPort: true,
    },
  };
});
