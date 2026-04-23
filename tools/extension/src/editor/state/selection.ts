import type { Automation, Step } from '@portalflow/schema';

// ---------------------------------------------------------------------------
// SelectedNode discriminated union
// ---------------------------------------------------------------------------

export type SelectedNode =
  | { kind: 'none' }
  | { kind: 'metadata' }
  | { kind: 'input'; index: number }
  | { kind: 'step'; path: number[] }
  | { kind: 'function'; index: number; stepPath?: number[] };

// ---------------------------------------------------------------------------
// parseNodeId
// ID encoding:
//   "metadata"                      → { kind: 'metadata' }
//   "input:0"                       → { kind: 'input', index: 0 }
//   "step:0"                        → { kind: 'step', path: [0] }
//   "step:0.2.1"                    → { kind: 'step', path: [0, 2, 1] }
//   "function:0"                    → { kind: 'function', index: 0 }
//   "function:0:step:1"             → { kind: 'function', index: 0, stepPath: [1] }
//   "function:0:step:1.2"           → { kind: 'function', index: 0, stepPath: [1, 2] }
// ---------------------------------------------------------------------------

export function parseNodeId(id: string | null): SelectedNode {
  if (!id) return { kind: 'none' };

  if (id === 'metadata') return { kind: 'metadata' };

  if (id.startsWith('input:')) {
    const index = parseInt(id.slice('input:'.length), 10);
    if (isNaN(index)) return { kind: 'none' };
    return { kind: 'input', index };
  }

  if (id.startsWith('step:')) {
    const pathStr = id.slice('step:'.length);
    const path = parseDotPath(pathStr);
    if (path === null) return { kind: 'none' };
    return { kind: 'step', path };
  }

  if (id.startsWith('function:')) {
    // function:N or function:N:step:M or function:N:step:M.K
    const rest = id.slice('function:'.length);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) {
      const index = parseInt(rest, 10);
      if (isNaN(index)) return { kind: 'none' };
      return { kind: 'function', index };
    }
    const fnIndex = parseInt(rest.slice(0, colonIdx), 10);
    if (isNaN(fnIndex)) return { kind: 'none' };
    const stepPart = rest.slice(colonIdx + 1); // "step:M.K"
    if (!stepPart.startsWith('step:')) return { kind: 'none' };
    const pathStr = stepPart.slice('step:'.length);
    const stepPath = parseDotPath(pathStr);
    if (stepPath === null) return { kind: 'none' };
    return { kind: 'function', index: fnIndex, stepPath };
  }

  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// encodeNodeId
// ---------------------------------------------------------------------------

export function encodeNodeId(node: SelectedNode): string {
  switch (node.kind) {
    case 'none':
      return '';
    case 'metadata':
      return 'metadata';
    case 'input':
      return `input:${node.index}`;
    case 'step':
      return `step:${node.path.join('.')}`;
    case 'function':
      if (node.stepPath !== undefined) {
        return `function:${node.index}:step:${node.stepPath.join('.')}`;
      }
      return `function:${node.index}`;
  }
}

// ---------------------------------------------------------------------------
// getStepAtPath — walks automation.steps following the path array
// ---------------------------------------------------------------------------

export function getStepAtPath(automation: Automation, path: number[]): Step | null {
  return walkPath(automation.steps, path);
}

// ---------------------------------------------------------------------------
// getFunctionStepAtPath — walks a function body's steps
// ---------------------------------------------------------------------------

export function getFunctionStepAtPath(
  automation: Automation,
  fnIndex: number,
  path: number[],
): Step | null {
  const fn = (automation.functions ?? [])[fnIndex];
  if (!fn) return null;
  return walkPath(fn.steps, path);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseDotPath(s: string): number[] | null {
  if (!s) return null;
  const parts = s.split('.');
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some(isNaN)) return null;
  return nums;
}

function walkPath(steps: Step[], path: number[]): Step | null {
  const [head, ...tail] = path;
  const step = steps[head];
  if (!step) return null;
  if (tail.length === 0) return step;
  return walkPath(step.substeps ?? [], tail);
}
