// Tests for the Unix Ollama installer's terminal handling. The installer runs `sudo`,
// which reads its password from the terminal; these verify we hand it a cooked TTY (so
// the prompt isn't swallowed, which looked like an install frozen at 100%) and restore
// the prior state afterwards. A fake spawn keeps the real installer from running.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { isHomebrewAvailable, runMacBrewInstall, runUnixOllamaInstall } from '../src/setup/unixSetup.js';

// Minimal stdin stand-in that starts in raw mode, like a prior interactive prompt leaves it.
function makeStdin({ isTTY = true } = {}) {
  return {
    isTTY,
    _raw: true,
    paused: false,
    calls: [],
    get isRaw() {
      return this._raw;
    },
    setRawMode(value) {
      this._raw = value;
      this.calls.push(`raw:${value}`);
    },
    isPaused() {
      return this.paused;
    },
    pause() {
      this.paused = true;
      this.calls.push('pause');
    },
    resume() {
      this.paused = false;
      this.calls.push('resume');
    },
  };
}

test('runUnixOllamaInstall gives sudo a cooked TTY and restores raw mode on success', async () => {
  const stdin = makeStdin();
  const child = new EventEmitter();
  let spawned = null;
  const spawnFn = (cmd, args, opts) => {
    spawned = { cmd, args, opts };
    return child;
  };

  const promise = runUnixOllamaInstall({ spawnFn, stdin });

  // While the installer runs, raw mode is off so sudo can read the password.
  assert.equal(stdin.isRaw, false);
  assert.equal(spawned.cmd, 'sh');
  assert.equal(spawned.opts.stdio, 'inherit');
  assert.match(spawned.args[1], /curl .*ollama\.com\/install\.sh \| sh/);

  child.emit('close', 0);
  await promise;

  // Raw mode restored to its original value after the installer exits.
  assert.equal(stdin.isRaw, true);
});

test('runUnixOllamaInstall restores the TTY and rejects on a non-zero exit', async () => {
  const stdin = makeStdin();
  const child = new EventEmitter();

  const promise = runUnixOllamaInstall({ spawnFn: () => child, stdin });
  child.emit('close', 1);

  await assert.rejects(promise, /exited with code 1/);
  assert.equal(stdin.isRaw, true);
});

test('runUnixOllamaInstall does not touch raw mode when stdin is not a TTY', async () => {
  const stdin = makeStdin({ isTTY: false });
  const child = new EventEmitter();

  const promise = runUnixOllamaInstall({ spawnFn: () => child, stdin });
  child.emit('close', 0);
  await promise;

  assert.equal(stdin.calls.some((entry) => entry.startsWith('raw:')), false);
});

test('runMacBrewInstall runs "brew install ollama" with a cooked TTY', async () => {
  const stdin = makeStdin();
  const child = new EventEmitter();
  let spawned = null;
  const spawnFn = (cmd, args, opts) => {
    spawned = { cmd, args, opts };
    return child;
  };

  const promise = runMacBrewInstall({ spawnFn, stdin });

  assert.equal(stdin.isRaw, false);
  assert.equal(spawned.cmd, 'brew');
  assert.deepEqual(spawned.args, ['install', 'ollama']);
  assert.equal(spawned.opts.stdio, 'inherit');

  child.emit('close', 0);
  await promise;

  assert.equal(stdin.isRaw, true);
});

test('isHomebrewAvailable resolves true when brew --version exits 0', async () => {
  const child = new EventEmitter();
  const promise = isHomebrewAvailable({ spawnFn: () => child });
  child.emit('close', 0);
  assert.equal(await promise, true);
});

test('isHomebrewAvailable resolves false when brew is missing', async () => {
  const child = new EventEmitter();
  const promise = isHomebrewAvailable({ spawnFn: () => child });
  child.emit('error', new Error('spawn brew ENOENT'));
  assert.equal(await promise, false);
});

test('isHomebrewAvailable resolves false when spawn throws synchronously', async () => {
  const result = await isHomebrewAvailable({
    spawnFn: () => {
      throw new Error('ENOENT');
    },
  });

  assert.equal(result, false);
});
