// Transport-agnostic dispatcher for one model "call" frame. Used by the host's own
// WebSocket server (hostSocketServer.js): it runs the local OllamaService and emits
// token/thinking/result/error frames through `send`. Kept separate from any socket
// lifecycle so it is trivially testable with a mock OllamaService and a capturing `send`.
export async function handleRelayCall({ frame, ollamaService, send, log = null }) {
  const { id, method, args = {} } = frame ?? {};

  if (!id || !method) {
    return;
  }

  const startedAt = Date.now();
  let firstChunkAt = null;
  const markFirstChunk = () => {
    if (firstChunkAt === null) {
      firstChunkAt = Date.now();
    }
  };

  try {
    if (method === 'warmUp') {
      if (typeof ollamaService.warmUp === 'function') {
        await ollamaService.warmUp();
      }

      send({ type: 'result', id, value: { ok: true } });
      return;
    }

    if (method === 'generateReply') {
      const reply = await ollamaService.generateReply(args.messages ?? [], {
        onToken: (chunk) => {
          markFirstChunk();
          send({ type: 'token', id, chunk });
        },
        onThinking: (chunk) => {
          markFirstChunk();
          send({ type: 'thinking', id, chunk });
        },
        generationOptions: args.generationOptions ?? {},
        maxContinuations: args.maxContinuations ?? null,
        // Honor the client's reasoning decision (the cheap intent router sends think:false).
        think: args.think ?? null,
      });

      send({ type: 'result', id, value: reply });

      if (typeof log === 'function') {
        const first = firstChunkAt ? `${((firstChunkAt - startedAt) / 1000).toFixed(1)}s` : '—';
        const total = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        log(`host first chunk ${first} · host total ${total}`);
      }

      return;
    }

    if (method === 'generateToolTurn') {
      const message = await ollamaService.generateToolTurn(args.messages ?? [], {
        tools: args.tools ?? [],
      });

      send({ type: 'result', id, value: message });
      return;
    }

    send({ type: 'error', id, message: `Unknown relay method: ${method}` });
  } catch (error) {
    send({ type: 'error', id, message: error?.message ?? 'Relay call failed on the host' });
  }
}
