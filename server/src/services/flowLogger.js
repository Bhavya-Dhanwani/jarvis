// Per-request latency logger. Writes one [flow] line per model call to a log FILE (never
// the CLI), so you can confirm real per-response timing without cluttering the chat.
//
// Default path: <server>/logs/flow.log (already gitignored via `logs` + `*.log`).
// Override with JARVIS_FLOW_LOG=<absolute path>, or disable with JARVIS_FLOW_LOG=off.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DISABLED = /^(0|false|no|off)$/i;

// server/ root: this file is at server/src/services/flowLogger.js.
const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Resolved per call so JARVIS_FLOW_LOG can be set at runtime (CLI) or in tests.
function resolveTarget() {
  const configured = String(process.env.JARVIS_FLOW_LOG ?? '').trim();

  if (DISABLED.test(configured)) {
    return { enabled: false, path: null };
  }

  return { enabled: true, path: configured || join(SERVER_ROOT, 'logs', 'flow.log') };
}

// Remember which directories were already created so we mkdir at most once per path.
const dirReady = new Map();

function ensureDir(path) {
  const dir = dirname(path);

  if (!dirReady.has(dir)) {
    dirReady.set(dir, mkdir(dir, { recursive: true }).catch(() => {}));
  }

  return dirReady.get(dir);
}

const ms = (from, to) => (from && to ? `${to - from}ms` : '—');

// Build a readable single-line record: when the call was sent, when the first chunk
// (reasoning) arrived, when the first answer token arrived, and when it finished.
function formatLine({ method, id, sentAt, firstChunkAt, firstTokenAt, doneAt, chunks = 0, error = null }) {
  const stamp = new Date(doneAt ?? sentAt ?? Date.now()).toISOString();
  const parts = [
    `[flow] ${stamp}`,
    method ?? 'call',
    id != null ? `id=${id}` : '',
    `sent→first=${ms(sentAt, firstChunkAt)}`,
    `sent→answer=${ms(sentAt, firstTokenAt)}`,
    `first→done=${ms(firstChunkAt, doneAt)}`,
    `total=${ms(sentAt, doneAt)}`,
    `tokens=${chunks}`,
    error ? `error=${JSON.stringify(String(error))}` : '',
  ].filter(Boolean);

  return `${parts.join(' ')}\n`;
}

// Append one timing record. Fire-and-forget — logging must never break or slow a reply.
export function logFlow(record) {
  const { enabled, path } = resolveTarget();

  if (!enabled) {
    return;
  }

  const line = formatLine(record);
  ensureDir(path).then(() => appendFile(path, line)).catch(() => {});
}

// Where flow lines are written (null when disabled). Useful for a one-time hint.
export function getFlowLogPath() {
  return resolveTarget().path;
}
