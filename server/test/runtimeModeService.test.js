import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
