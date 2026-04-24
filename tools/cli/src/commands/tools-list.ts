import { ToolExecutor } from '../tools/tool-executor.js';
import { SmscliAdapter } from '../tools/smscli.adapter.js';
import { VaultcliAdapter } from '../tools/vaultcli.adapter.js';
import type { Tool, ToolDescription } from '../tools/tool.interface.js';

/**
 * Build the canonical tool inventory by instantiating every adapter the
 * runner registers. Mirrors the wiring in automation-runner.ts so the
 * `tools list` command and the runner can never disagree about which
 * tools exist.
 *
 * The adapter constructors take a ToolExecutor for command execution; we
 * never actually run anything here — we just call `describe()` on each.
 */
export function collectToolDescriptions(): ToolDescription[] {
  const toolExecutor = new ToolExecutor();
  const tools: Tool[] = [
    new SmscliAdapter(toolExecutor),
    new VaultcliAdapter(toolExecutor),
  ];
  return tools.map((t) => t.describe());
}

/**
 * Body of `portalflow tools list [--pretty]`. Emits the tool inventory
 * the LLM sees during aiscope steps. The default output is a single-line
 * JSON array; `--pretty` indents for human reading.
 *
 * The shape is `ToolDescription[]` from `tools/tool.interface.ts` —
 * stable across minor versions; agents can rely on it.
 */
export function runToolsListCommand(opts: { pretty?: boolean }): void {
  const inventory = collectToolDescriptions();
  const text = opts.pretty
    ? JSON.stringify(inventory, null, 2)
    : JSON.stringify(inventory);
  process.stdout.write(text + '\n');
}
