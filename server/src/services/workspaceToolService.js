import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Expose workspace-bounded tools in Ollama's native function-calling format.
export class WorkspaceToolService {
  constructor({ cwd = process.cwd() } = {}) {
    this.cwd = resolve(cwd);
  }

  definitions({ writable = true } = {}) {
    const tools = [
      tool('list_files', 'List files and folders. Call with {"path":"."} for the workspace root.', {
        path: stringProperty('Workspace-relative directory path. Use "." for the root.', { minLength: 1 }),
      }, ['path']),
      tool('read_file', 'Read one UTF-8 text file. The path must name a file, not a directory.', {
        path: stringProperty('Workspace-relative file path, for example "src/app.js".', { minLength: 1 }),
      }, ['path']),
    ];

    if (writable) {
      tools.push(
        tool('write_file', 'Create or completely replace one UTF-8 file. Always provide both path and complete content in the same call.', {
          path: stringProperty('Workspace-relative destination file path, for example "chat_interface.html". Never omit this field.', { minLength: 1 }),
          content: stringProperty('Complete file content to write. Never omit this field.'),
        }, ['path', 'content']),
        tool('append_file', 'Append the next non-duplicate chunk to a file created by write_file. Use this for long files that do not fit in one tool call.', {
          path: stringProperty('Workspace-relative existing file path.', { minLength: 1 }),
          content: stringProperty('Only the next new chunk. Do not repeat content already written.', { minLength: 1 }),
        }, ['path', 'content']),
        tool('finish_file', 'Mark a file as complete after all chunks have been written. This tool does not change file content.', {
          path: stringProperty('Workspace-relative completed file path.', { minLength: 1 }),
        }, ['path']),
        tool('replace_in_file', 'Replace one exact text occurrence in an existing file. Use read_file first when the current text is unknown.', {
          path: stringProperty('Workspace-relative existing file path.', { minLength: 1 }),
          old_text: stringProperty('Exact existing text to replace.', { minLength: 1 }),
          new_text: stringProperty('Replacement text.'),
        }, ['path', 'old_text', 'new_text']),
      );
    }

    return tools;
  }

  // Normalize common local-model argument variants before validating a tool call.
  normalizeArguments(name, value = {}, { fallbackPath = '' } = {}) {
    const args = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = { ...args };

    if (['read_file', 'write_file', 'append_file', 'finish_file', 'replace_in_file'].includes(name)) {
      normalized.path = firstString(
        args.path,
        args.file_path,
        args.filepath,
        args.filename,
        args.file,
        args.target_path,
        args.target,
        fallbackPath,
      );

      if (normalized.path) {
        normalized.path = this.#display(this.#resolve(normalized.path));
      }
    }

    if (name === 'list_files') {
      normalized.path = firstString(args.path, args.directory, args.dir, args.folder, '.');
    }

    if (name === 'write_file' || name === 'append_file') {
      normalized.content = firstDefined(args.content, args.file_content, args.code, args.text, args.body);
    }


    if (name === 'replace_in_file') {
      normalized.old_text = firstDefined(args.old_text, args.oldText, args.search, args.find);
      normalized.new_text = firstDefined(args.new_text, args.newText, args.replacement, args.replace);
    }

    return normalized;
  }

  async execute(name, args = {}, { writable = true } = {}) {
    if (name === 'list_files') {
      const target = this.#resolve(args.path ?? '.');
      const entries = await readdir(target, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}\t${entry.name}`)
        .join('\n');
    }

    if (name === 'read_file') {
      return readFile(this.#resolveRequiredPath(args.path, name), 'utf8');
    }

    if (!writable) {
      throw new Error(`Tool ${name} is not available in read-only mode.`);
    }

    if (name === 'write_file') {
      const target = this.#resolveRequiredPath(args.path, name);

      if (args.content === undefined || args.content === null) {
        throw new Error('write_file requires complete file content.');
      }

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, String(args.content), 'utf8');
      return `Wrote ${countLines(String(args.content))} lines to ${this.#display(target)}.`;
    }

    if (name === 'append_file') {
      const target = this.#resolveRequiredPath(args.path, name);

      if (args.content === undefined || args.content === null || String(args.content).length === 0) {
        throw new Error('append_file requires a non-empty continuation chunk.');
      }

      await appendFile(target, String(args.content), 'utf8');
      return `Appended ${countLines(String(args.content))} lines to ${this.#display(target)}.`;
    }

    if (name === 'finish_file') {
      const target = this.#resolveRequiredPath(args.path, name);
      await readFile(target, 'utf8');
      return `Finished ${this.#display(target)}.`;
    }

    if (name === 'replace_in_file') {
      const target = this.#resolveRequiredPath(args.path, name);
      const content = await readFile(target, 'utf8');
      const oldText = String(args.old_text ?? '');

      if (!oldText || !content.includes(oldText)) {
        throw new Error(`Exact text was not found in ${this.#display(target)}.`);
      }

      await writeFile(target, content.replace(oldText, String(args.new_text ?? '')), 'utf8');
      return `Updated ${this.#display(target)}.`;
    }

    throw new Error(`Unknown workspace tool: ${name}`);
  }

  // Return a safe relative path only when a candidate stays inside this workspace.
  workspacePath(candidate) {
    try {
      return this.#display(this.#resolve(candidate));
    } catch {
      return '';
    }
  }

  #resolve(path) {
    const rawPath = String(path ?? '').trim();
    const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(this.cwd, rawPath);
    const outside = relative(this.cwd, target);

    if (outside === '..' || outside.startsWith(`..${pathSeparator()}`) || outside.startsWith('../') || outside.startsWith('..\\')) {
      throw new Error('Tool path must stay inside the active workspace.');
    }

    return target;
  }

  #resolveRequiredPath(path, toolName) {
    if (!String(path ?? '').trim() || String(path).trim() === '.') {
      throw new Error(`${toolName} requires a file path relative to the workspace.`);
    }

    return this.#resolve(path);
  }

  #display(path) {
    return relative(this.cwd, path) || '.';
  }
}

export function createWorkspaceToolService(options) {
  return new WorkspaceToolService(options);
}

function tool(name, description, properties, required = []) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

function stringProperty(description, extra = {}) {
  return {
    type: 'string',
    description,
    ...extra,
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  return content.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

function pathSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

