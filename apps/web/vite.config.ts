import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {offlineShell} from './offlineShell';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    publicDir: "public",
    plugins: [react(), tailwindcss(),offlineShell()],
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
