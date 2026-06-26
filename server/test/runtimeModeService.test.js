import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRuntimeConfig } from '../src/cli/index.js';
import { loadAuth } from '../src/services/runtimeModeService.js';

test('auth loading follows the active config data root', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'jarvis-data-'));
  const configPath = join(dataRoot, 'config.json');
  const authPath = join(dataRoot, 'auth.json');

  writeFileSync(configPath, JSON.stringify({
    mode: 'client',
    dataRoot,
    signalingServerUrl: 'https://jarvis.example.com',
  }));
  writeFileSync(authPath, JSON.stringify({
    refreshToken: 'refresh-token',
    accessToken: 'access-token',
    serverUrl: 'https://jarvis.example.com',
  }));

  const auth = loadAuth({
    env: {
      JARVIS_CONFIG_PATH: configPath,
    },
  });

  assert.equal(auth.refreshToken, 'refresh-token');
  assert.equal(auth.serverUrl, 'https://jarvis.example.com');
  assert.equal(auth.path, authPath);
});

test('client runtime fetches the latest host URL on every preparation', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'jarvis-client-'));
  const configPath = join(dataRoot, 'config.json');
  const authPath = join(dataRoot, 'auth.json');
  const claimedUrls = [
    'https://first.trycloudflare.com',
    'https://second.trycloudflare.com',
  ];
  const calls = [];

  writeFileSync(configPath, JSON.stringify({
    mode: 'client',
    model: 'gemma4:e4b',
    host: 'https://stale.trycloudflare.com',
    dataRoot,
    signalingServerUrl: 'https://jarvis.example.com',
    remoteHostTemporary: true,
  }));
  writeFileSync(authPath, JSON.stringify({
    refreshToken: 'refresh-token',
    serverUrl: 'https://jarvis.example.com',
  }));

  const context = {
    env: {
      JARVIS_CONFIG_PATH: configPath,
    },
    refreshAccessToken: async ({ serverUrl, refreshToken }) => {
      calls.push({ type: 'refresh', serverUrl, refreshToken });
      return 'access-token';
    },
    claimOllamaUrl: async ({ serverUrl, accessToken }) => {
      calls.push({ type: 'claim', serverUrl, accessToken });
      return {
        data: {
          available: true,
          url: claimedUrls.shift(),
        },
      };
    },
  };

  const first = await prepareRuntimeConfig(context);
  const second = await prepareRuntimeConfig(context);
  const saved = JSON.parse(readFileSync(configPath, 'utf8'));

  assert.equal(first.host, 'https://first.trycloudflare.com');
  assert.equal(second.host, 'https://second.trycloudflare.com');
  assert.equal(saved.host, 'https://second.trycloudflare.com');
  assert.equal(calls.filter((call) => call.type === 'claim').length, 2);
});

test('client runtime waits for host URL instead of closing in keep-alive mode', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'jarvis-client-wait-'));
  const configPath = join(dataRoot, 'config.json');
  const authPath = join(dataRoot, 'auth.json');
  const messages = [];
  let claims = 0;

  writeFileSync(configPath, JSON.stringify({
    mode: 'client',
    model: 'gemma4:e4b',
    host: 'https://stale.trycloudflare.com',
    dataRoot,
    signalingServerUrl: 'https://jarvis.example.com',
    remoteHostTemporary: true,
  }));
  writeFileSync(authPath, JSON.stringify({
    refreshToken: 'refresh-token',
    serverUrl: 'https://jarvis.example.com',
  }));

  const result = await prepareRuntimeConfig({
    env: {
      JARVIS_CONFIG_PATH: configPath,
    },
    output: (line) => messages.push(line),
    outputStream: { isTTY: true },
    clientUrlPollIntervalMs: 1,
    refreshAccessToken: async () => 'access-token',
    claimOllamaUrl: async () => {
      claims += 1;

      return {
        data: claims === 1
          ? { available: false, url: null }
          : { available: true, url: 'https://fresh.trycloudflare.com' },
      };
    },
  });

  const saved = JSON.parse(readFileSync(configPath, 'utf8'));

  assert.equal(result.host, 'https://fresh.trycloudflare.com');
  assert.equal(saved.host, 'https://fresh.trycloudflare.com');
  assert.equal(claims, 2);
  assert.match(messages.join('\n'), /URL not available/);
});
