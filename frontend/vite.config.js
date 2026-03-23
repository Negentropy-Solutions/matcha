import path from 'path';
import { createRequire } from 'module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

const common_site_config = (() => {
  try {
    return require('../../../sites/common_site_config.json');
  } catch {
    return { webserver_port: 8000 };
  }
})();
const { webserver_port = 8000 } = common_site_config;

const proxyOptions = {
  '^/(app|api|assets|files|private)': {
    target: `http://127.0.0.1:${webserver_port}`,
    ws: true,
    router(req) {
      const site_name = req.headers.host.split(':')[0];
      return `http://${site_name}:${webserver_port}`;
    },
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8081,
    host: '0.0.0.0',
    proxy: proxyOptions,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../matcha/public/matcha',
    emptyOutDir: true,
    target: 'es2015',
  },
});
