import { spawn } from 'node:child_process';
import type { ToolExecutionOptions } from './tool.interface.js';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ToolExecutor {
  async run(
    binary: string,
    args: string[],
    options?: ToolExecutionOptions,
  ): Promise<RunResult> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const cwd = options?.cwd;

    return new Promise((resolve, reject) => {
      let proc: ReturnType<typeof spawn>;

      try {
        proc = spawn(binary, args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        // spawn itself throws synchronously only in rare cases; the ENOENT
        // surface usually arrives via the 'error' event below.
        reject(new Error(`Failed to start '${binary}': ${(err as Error).message}`));
        return;
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout!.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr!.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        // Give the process a moment to exit gracefully, then force-kill.
        setTimeout(() => proc.kill('SIGKILL'), 2_000);
      }, timeout);

      proc.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `Binary '${binary}' not found. Make sure it is installed and available on PATH.`,
            ),
          );
        } else {
          reject(new Error(`Process error for '${binary}': ${err.message}`));
        }
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            new Error(
              `'${binary}' timed out after ${timeout}ms and was killed.`,
            ),
          );
          return;
        }
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code ?? 1,
        });
      });
    });
  }
}
