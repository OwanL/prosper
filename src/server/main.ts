import { Runtime } from './runtime.ts';
import { createApiServer } from './http.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory } from './checkpoint.ts';

let runtime: Runtime | undefined;
let startupError: string | undefined;
try {
  const restore =
    process.env.PROSPER_RESTORE === '1' ||
    (process.env.PROSPER_RESTORE !== '0' && existsSync(join(dataDirectory(), 'checkpoint.json')));
  runtime = new Runtime({ restore });
} catch (error) {
  startupError = error instanceof Error ? error.message : String(error);
  console.error(`Restore/startup refused: ${startupError}`);
}
const server = createApiServer({ runtime, error: startupError });
const port = Number(process.env.PROSPER_PORT ?? 4310);
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const boundPort = address && typeof address !== 'string' ? address.port : port;
  process.send?.({ type: startupError ? 'failed' : 'ready', error: startupError, port: boundPort });
  console.log(
    `Prosper backend http://127.0.0.1:${boundPort} (${startupError ? 'error: checkpoint preserved' : 'ready'})`,
  );
});
server.on('error', (error) => {
  process.send?.({ type: 'failed', error: error.message });
  console.error(error);
  shutdown();
});
function shutdown() {
  runtime?.close();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('disconnect', shutdown);
process.on('message', (message) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'prepare') {
    const id = 'id' in message ? message.id : undefined;
    try {
      if (!runtime) throw new Error(startupError ?? 'Runtime unavailable.');
      runtime.checkpoint(true);
      process.send?.({ type: 'prepared', id, checkpoint: runtime.checkpointPath });
    } catch (error) {
      process.send?.({
        type: 'prepare-failed',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (message.type === 'stop') shutdown();
});
