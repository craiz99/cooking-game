import http from 'node:http';
import { createApp } from './app.js';
import { getAdvertisedHost } from './security.js';
import { attachSocketServer } from './socketServer.js';
import { TripStore } from './store.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.BIND_HOST ?? '0.0.0.0';

export function startServer(options: { port?: number; dbPath?: string } = {}): {
  server: http.Server;
  store: TripStore;
  close: () => Promise<void>;
} {
  const port = options.port ?? PORT;
  const store = new TripStore(options.dbPath);
  const app = createApp({ store });
  const server = http.createServer(app);
  const { stopLoop } = attachSocketServer(server, store);

  server.listen(port, HOST, () => {
    const advertisedHost = getAdvertisedHost();
    console.log('');
    console.log('🚐 Purple Van Road Trip server is running!');
    console.log(`   Local:   http://localhost:${port}`);
    if (advertisedHost !== 'localhost') {
      console.log(`   Wi-Fi:   http://${advertisedHost}:${port}`);
    }
    console.log('');
  });

  const close = () =>
    new Promise<void>((resolve) => {
      stopLoop();
      server.close(() => {
        store.close();
        resolve();
      });
    });

  const shutdown = (signal: string) => {
    console.log(`\nReceived ${signal}; shutting down cleanly...`);
    void close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  if (import.meta.url === `file://${process.argv[1]}`) {
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  return { server, store, close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
