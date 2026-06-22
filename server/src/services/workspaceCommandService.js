// Import child process execution.
import { exec, execFile } from 'node:child_process';
// Import path resolution.
import { resolve } from 'node:path';
// Import promise helper.
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Run commands inside one fixed workspace.
export class WorkspaceCommandService {
  // Store workspace and execution configuration.
  constructor({
    cwd = process.cwd(),
    timeoutMs = 120000,
    maxBuffer = 1024 * 1024,
  } = {}) {
    // Resolve once so commands cannot silently change the workspace boundary.
    this.cwd = resolve(cwd);
    // Store command timeout.
    this.timeoutMs = timeoutMs;
    // Store output limit.
    this.maxBuffer = maxBuffer;
  }

  // Run an explicit shell command in the workspace.
  async run(command) {
    const value = String(command ?? '').trim();

    if (!value) {
      throw new Error('Command is required.\nUsage: /run <command>');
    }

    if (/^git\s+push(?:\s|$)/i.test(value)) {
      throw new Error('Use /git push so publishing remains an explicit action.');
    }

    return this.#execute(() => execAsync(value, {
      cwd: this.cwd,
      timeout: this.timeoutMs,
      maxBuffer: this.maxBuffer,
      windowsHide: true,
    }));
  }

  // Push the current Git branch through the Git executable.
  async gitPush(args = []) {
    const pushArgs = ['push', ...args];

    return this.#execute(() => execFileAsync('git', pushArgs, {
      cwd: this.cwd,
      timeout: this.timeoutMs,
      maxBuffer: this.maxBuffer,
      windowsHide: true,
    }));
  }

  // Normalize successful and failed process results.
  async #execute(action) {
    try {
      const { stdout = '', stderr = '' } = await action();

      return {
        status: 'completed',
        exitCode: 0,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      };
    } catch (error) {
      return {
        status: 'failed',
        exitCode: error.code ?? 1,
        stdout: String(error.stdout ?? '').trimEnd(),
        stderr: String(error.stderr ?? error.message ?? '').trimEnd(),
      };
    }
  }
}

// Create a workspace command service.
export function createWorkspaceCommandService(options) {
  return new WorkspaceCommandService(options);
}
