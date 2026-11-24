import http from 'node:http';
import { createApp } from './app.js';
import { getAdvertisedHost } from './security.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.BIND_HOST ?? '0.0.0.0';

export function startServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);

  server.listen(PORT, HOST, () => {
    const advertisedHost = getAdvertisedHost();
    console.log('');
    console.log('🚐 Purple Van Road Trip server is running!');
    console.log(`   Local:   http://localhost:${PORT}`);
    if (advertisedHost !== 'localhost') {
      console.log(`   Wi-Fi:   http://${advertisedHost}:${PORT}`);
    }
    console.log('');
  });

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}; shutting down cleanly...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
