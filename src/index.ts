import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const { app, disposable } = buildServer(config);

// Warm the blocklist before accepting traffic so the first lead is not the one
// that pays for the download. Failures are non-fatal: the seed list still works.
await disposable.ensureFresh().catch(() => {});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => process.exit(0));
  });
}
