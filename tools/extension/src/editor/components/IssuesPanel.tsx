import type { ZodIssue } from 'zod';
import type { ValidationResult } from '../state/editor-state';
import type { EditorAction } from '../state/editor-state';

// ---------------------------------------------------------------------------
// issuePathToNodeId
// Maps a Zod issue path to the owning node's encoded ID string.
//
// Path conventions:
//   ['steps', N, ...rest]               → "step:N"
//   ['steps', N, 'substeps', M, ...]    → "step:N.M"
//   ['inputs', N, ...]                  → "input:N"
//   ['functions', N, 'steps', M, ...]   → "function:N:step:M"
//   ['name' | 'goal' | ...]             → "metadata"
// ---------------------------------------------------------------------------

export function issuePathToNodeId(path: ZodIssue['path']): string {
  if (path.length === 0) return 'metadata';

  const first = path[0];

  if (first === 'steps' && typeof path[1] === 'number') {
    const stepIdx = path[1];
    // Check for nested substep: ['steps', N, 'substeps', M, ...]
    if (path[2] === 'substeps' && typeof path[3] === 'number') {
      return buildStepPath(path, 1);
    }
    return `step:${stepIdx}`;
  }

  if (first === 'inputs' && typeof path[1] === 'number') {
    return `input:${path[1]}`;
  }

  if (first === 'functions' && typeof path[1] === 'number') {
    const fnIdx = path[1];
    // function body step: ['functions', N, 'steps', M, ...]
    if (path[2] === 'steps' && typeof path[3] === 'number') {
      const stepIdx = path[3];
      // nested substep inside function: ['functions', N, 'steps', M, 'substeps', K, ...]
      if (path[4] === 'substeps' && typeof path[5] === 'number') {
        return `function:${fnIdx}:step:${stepIdx}.${path[5]}`;
      }
      return `function:${fnIdx}:step:${stepIdx}`;
    }
    return `function:${fnIdx}`;
  }

  // Top-level scalar fields (name, goal, description, etc.)
  return 'metadata';
}

/**
 * Builds a dot-joined step path from a Zod path starting at a 'steps' element.
 * e.g. path = ['steps', 0, 'substeps', 1] -> "step:0.1"
 */
function buildStepPath(path: ZodIssue['path'], startIdx: number): string {
  const parts: number[] = [];
  let i = startIdx;
  while (i < path.length) {
    const segment = path[i];
    if (segment === 'substeps' && typeof path[i + 1] === 'number') {
      i++; // skip 'substeps'
      parts.push(path[i] as number);
    } else if (typeof segment === 'number') {
      parts.push(segment);
    } else {
      break;
    }
    i++;
  }
  return `step:${parts.join('.')}`;
}

// ---------------------------------------------------------------------------
// IssuesPanel component
// ---------------------------------------------------------------------------

interface IssuesPanelProps {
  validation: ValidationResult;
  dispatch: (action: EditorAction) => void;
}

export function IssuesPanel({ validation, dispatch }: IssuesPanelProps) {
  if (validation.success) {
    return (
      <div className="issues-panel issues-panel--empty">
        <span className="issues-ok">No issues — automation is valid</span>
      </div>
    );
  }

  const issues = validation.error.issues;

  return (
    <div className="issues-panel">
      {issues.map((issue, idx) => {
        const pathStr =
          issue.path.length > 0
            ? issue.path.join('.')
            : '(root)';
        const nodeId = issuePathToNodeId(issue.path);

        return (
          <div
            key={idx}
            className="issue-row"
            title={`Click to select ${nodeId}`}
            onClick={() => dispatch({ type: 'SELECT_NODE', payload: nodeId })}
          >
            <span className="issue-path">{pathStr}</span>
            <span className="issue-message">{issue.message}</span>
          </div>
        );
      })}
    </div>
  );
}
