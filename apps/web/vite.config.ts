import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  if (env.VITE_SENSA_MODE === "legacy-account") {
    for (const name of ["VITE_SENSA_API_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
      if (!env[name]?.trim()) throw new Error(`Sensa legacy account regression mode requires ${name}`);
    }
  }
  return {
    publicDir: "public",
    plugins: [react(), tailwindcss()],
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
