import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Audit is diagnostic only: disk failures must never affect planning or accounting.
export function recordAudit(audit, event) {
  try { return audit?.record(event) ?? false; } catch { return false; }
}

export function createAudit({ filePath, maxBytes = 2 * 1024 * 1024, archives = 2 } = {}) {
  if (typeof filePath !== 'string' || !filePath || !Number.isSafeInteger(maxBytes) || maxBytes < 256
      || !Number.isSafeInteger(archives) || archives < 0 || archives > 10) throw new Error('Invalid audit configuration.');
  const sessionId = randomUUID();
  let lastError = null;
  return {
    snapshot: () => ({ enabled: true, filePath, maxBytes, archives, lastError }),
    record(event) {
      try {
        const line = JSON.stringify({ ...event, sessionId, recordedAt: new Date().toISOString() }) + '\n';
        const bytes = Buffer.byteLength(line);
        if (bytes > maxBytes) throw new Error('Audit record exceeds file limit');
        mkdirSync(dirname(filePath), { recursive: true });
        const size = existsSync(filePath) ? statSync(filePath).size : 0;
        if (size + bytes > maxBytes) {
          if (archives === 0) rmSync(filePath, { force: true });
          else {
            rmSync(`${filePath}.${archives}`, { force: true });
            for (let index = archives - 1; index >= 1; index--) {
              if (existsSync(`${filePath}.${index}`)) renameSync(`${filePath}.${index}`, `${filePath}.${index + 1}`);
            }
            if (existsSync(filePath)) renameSync(filePath, `${filePath}.1`);
          }
        }
        appendFileSync(filePath, line, 'utf8');
        lastError = null;
        return true;
      } catch {
        lastError = 'Local audit write failed; simulation and budget accounting are unaffected.';
        return false;
      }
    },
  };
}
