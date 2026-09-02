import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/prototype/semantic-agent': 'http://localhost:5175',
    },
  },
});
