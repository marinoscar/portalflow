import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const InputSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'secret', 'number', 'boolean']),
  required: z.boolean().default(true),
  source: z.enum(['env', 'vaultcli', 'cli_arg', 'literal']).optional(),
  value: z.string().optional(),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Actions (discriminated union keyed on step type)
// ---------------------------------------------------------------------------

export const NavigateActionSchema = z.object({
  url: z.string(),
});

export const InteractActionSchema = z.object({
  interaction: z.enum(['click', 'type', 'select', 'check', 'uncheck', 'hover', 'focus']),
  value: z.string().optional(),
  inputRef: z.string().optional(),
});

export const WaitActionSchema = z.object({
  condition: z.enum(['selector', 'navigation', 'delay', 'network_idle']),
  value: z.string().optional(),
  timeout: z.number().optional(),
});

export const ExtractActionSchema = z.object({
  target: z.enum(['text', 'attribute', 'html', 'url', 'title', 'screenshot']),
  attribute: z.string().optional(),
  outputName: z.string(),
  // When true on a `target: 'html'` extract, the CLI writes the extracted
  // HTML to disk under the run's htmlDir and registers the path as a run
  // artifact. The outputs map keeps the (possibly transformed) string so
  // downstream steps can template against it. Ignored on every other target.
  saveToFile: z.boolean().optional(),
  // Transform to apply to the extracted HTML before saving / storing.
  //   - 'raw'        — pass-through (default)
  //   - 'simplified' — DOM walk that drops scripts/styles/comments and most
  //                    attributes, emits a compact YAML-ish tree suitable
  //                    for LLM consumption
  //   - 'markdown'   — HTML → Markdown via turndown
  // Only applies when target is 'html'. Ignored on every other target.
  format: z.enum(['raw', 'simplified', 'markdown']).optional(),
});

export const ToolCallActionSchema = z.object({
  tool: z.enum(['smscli', 'vaultcli']),
  command: z.string(),
  args: z.record(z.string()).optional(),
  outputName: z.string().optional(),
});

export const ConditionActionSchema = z
  .object({
    check: z
      .enum(['element_exists', 'url_matches', 'text_contains', 'variable_equals'])
      .optional(),
    value: z.string().optional(),
    ai: z.string().optional(),
    thenStep: z.string().optional(),
    elseStep: z.string().optional(),
    // Name of a function to invoke when the condition evaluates to true/false.
    // No args are accepted here — the function reads shared context. For
    // parametrized branching, use a regular `call` step after the condition.
    thenCall: z.string().optional(),
    elseCall: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasCheck = data.check !== undefined;
      const hasAi = data.ai !== undefined && data.ai.trim().length > 0;
      return (hasCheck || hasAi) && !(hasCheck && hasAi);
    },
    {
      message:
        'condition action must have exactly one of "check" (deterministic) or "ai" (plain-English question), not both',
    },
  )
  .refine(
    (data) => {
      if (data.check === undefined) return true;
      return data.value !== undefined;
    },
    {
      message: 'condition action with a deterministic "check" requires a "value"',
      path: ['value'],
    },
  );

export const DownloadActionSchema = z.object({
  trigger: z.enum(['click', 'navigation']),
  outputDir: z.string().optional(),
  expectedFilename: z.string().optional(),
});

export const LoopItemsSchema = z.object({
  description: z.string(),
  selectorPattern: z.string().optional(),
  itemVar: z.string().default('item'),
  order: z.enum(['first', 'last', 'newest', 'oldest', 'natural']).default('natural'),
});

export const LoopExitWhenSchema = z.object({
  check: z.enum([
    'element_exists',
    'element_missing',
    'url_matches',
    'text_contains',
    'variable_equals',
  ]),
  value: z.string(),
});

export const LoopActionSchema = z.object({
  maxIterations: z.union([z.number().int().min(1), z.string()]),
  items: LoopItemsSchema.optional(),
  exitWhen: LoopExitWhenSchema.optional(),
  indexVar: z.string().default('loop_index'),
});

// A call to a named function defined in the top-level `functions` array.
// `args` values may contain template expressions; they are resolved at call
// time and assigned to the function's declared parameters.
export const CallActionSchema = z.object({
  function: z.string().min(1),
  args: z.record(z.string()).optional(),
});

// A goto step jumps the runner's instruction pointer to a named top-level
// step. Useful for retry-from-earlier patterns (e.g. a condition detects
// that a login failed and falls back to a handler that re-attempts from
// step 1). Template syntax is allowed on targetStepId so the jump target
// can be variable-driven; non-templated values are schema-validated to
// point at a known top-level step id.
export const GotoActionSchema = z.object({
  targetStepId: z.string().min(1),
});

// An `aiscope` step hands control to an LLM for a bounded, goal-driven
// sub-run. The runner enters a loop: observe the page (HTML + optional
// screenshot), evaluate the success check, ask the LLM for the next
// action, dispatch it through PageService, and repeat until the goal is
// reached or a budget cap fires. Both budget caps are enforced — whichever
// one trips first aborts the step with a clear error.
//
// This is explicitly NOT a framework-backed autonomous agent: the action
// vocabulary is fixed, the observation surface is the existing page
// context, and the scope is a single goal with a hard ceiling. Use it for
// "figure out how to dismiss the cookie banner" style deviations from an
// otherwise deterministic flow, not for open-ended tasks.
//
// `successCheck` is optional. When present it is the authoritative oracle
// (the LLM's `done` emission is treated as a hint and re-verified against
// the check). When absent, the LLM self-terminates: it emits `done` when it
// believes the goal is reached and the runner trusts it immediately. The
// budget caps remain the only safety net in self-terminating mode — use it
// only for goals whose completion condition is hard to write as a concrete
// predicate.
//
// `mode` selects between two execution strategies:
//   - 'fast' (default) — one LLM call per iteration picks the next action.
//     No planning phase, no milestone tracking. Cheapest; best for single-
//     phase goals (dismiss a banner, click the visible next button).
//   - 'agent' — the step opens with a planning call that produces a linear
//     list of milestones, then each iteration reasons about the plan, the
//     current milestone, and the page before picking an action. The LLM
//     may emit `milestoneComplete: true` to advance, or `replan: true` to
//     discard the plan and rebuild it. Replans are capped by `maxReplans`.
//     Right for compound goals (login + navigate + extract + confirm) at
//     roughly 1.5-3x the tokens of fast mode.
export const AiScopeSuccessCheckSchema = z
  .object({
    check: z
      .enum(['element_exists', 'url_matches', 'text_contains', 'variable_equals'])
      .optional(),
    value: z.string().optional(),
    ai: z.string().optional(),
  })
  .refine(
    (sc) => {
      const hasCheck = sc.check !== undefined;
      const hasAi = sc.ai !== undefined && sc.ai.trim().length > 0;
      return (hasCheck || hasAi) && !(hasCheck && hasAi);
    },
    {
      message:
        'aiscope successCheck must have exactly one of "check"+"value" (deterministic) or "ai" (plain-English question)',
    },
  )
  .refine((sc) => sc.check === undefined || sc.value !== undefined, {
    message: 'aiscope successCheck with a deterministic "check" requires a "value"',
    path: ['value'],
  });

export const AiScopeActionSchema = z.object({
  goal: z.string().min(1),
  successCheck: AiScopeSuccessCheckSchema.optional(),
  mode: z.enum(['fast', 'agent']).default('fast'),
  maxReplans: z.number().int().min(0).max(10).default(2),
  maxDurationSec: z.number().int().min(1).max(3600).default(300),
  maxIterations: z.number().int().min(1).max(200).default(25),
  disallowedActions: z
    .array(
      z.enum([
        'navigate',
        'click',
        'type',
        'select',
        'check',
        'uncheck',
        'hover',
        'focus',
        'scroll',
        'wait',
        'done',
      ]),
    )
    .optional()
    .describe(
      'Actions the LLM must NOT emit. When omitted or empty, the full action vocabulary is allowed. ' +
        'Use this to block specific actions (e.g., [\'navigate\'] to prevent the LLM from navigating away from the current page).',
    ),
  includeScreenshot: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export const SelectorsSchema = z.object({
  primary: z.string(),
  fallbacks: z.array(z.string()).optional(),
});

export const ValidationSchema = z.object({
  type: z.enum(['url_contains', 'element_visible', 'text_present', 'title_contains']),
  value: z.string(),
});

// Concrete action output types (with defaults resolved) for each step kind.
type NavigateActionOutput = z.output<typeof NavigateActionSchema>;
type InteractActionOutput = z.output<typeof InteractActionSchema>;
type WaitActionOutput = z.output<typeof WaitActionSchema>;
type ExtractActionOutput = z.output<typeof ExtractActionSchema>;
type ToolCallActionOutput = z.output<typeof ToolCallActionSchema>;
type ConditionActionOutput = z.output<typeof ConditionActionSchema>;
type DownloadActionOutput = z.output<typeof DownloadActionSchema>;
type LoopActionOutput = z.output<typeof LoopActionSchema>;
type CallActionOutput = z.output<typeof CallActionSchema>;
type GotoActionOutput = z.output<typeof GotoActionSchema>;
type AiScopeActionOutput = z.output<typeof AiScopeActionSchema>;

// Forward-declare the Step interface so TypeScript can resolve z.lazy() recursion.
export interface Step {
  id: string;
  name: string;
  description?: string;
  type: 'navigate' | 'interact' | 'wait' | 'extract' | 'tool_call' | 'condition' | 'download' | 'loop' | 'call' | 'goto' | 'aiscope';
  action: NavigateActionOutput
    | InteractActionOutput
    | WaitActionOutput
    | ExtractActionOutput
    | ToolCallActionOutput
    | ConditionActionOutput
    | DownloadActionOutput
    | LoopActionOutput
    | CallActionOutput
    | GotoActionOutput
    | AiScopeActionOutput;
  aiGuidance?: string;
  selectors?: z.output<typeof SelectorsSchema>;
  validation?: z.output<typeof ValidationSchema>;
  onFailure: 'retry' | 'skip' | 'abort';
  maxRetries: number;
  timeout: number;
  substeps?: Step[];
}

// Common step fields shared by every type variant of the discriminated
// union below. Factored into a helper so each variant can spread them
// alongside its own `type` literal and matching action schema without
// repeating eleven fields eleven times.
//
// `substeps` is a recursive reference to StepSchema, so we wrap it in
// `z.lazy` — every variant needs the lazy wrapper so the union can be
// built before StepSchema is finalized.
function baseStepFields() {
  return {
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    aiGuidance: z.string().optional(),
    selectors: SelectorsSchema.optional(),
    validation: ValidationSchema.optional(),
    onFailure: z.enum(['retry', 'skip', 'abort']).default('abort'),
    maxRetries: z.number().int().min(0).default(3),
    timeout: z.number().int().min(0).default(30000),
    substeps: z.array(z.lazy(() => StepSchema)).optional(),
  };
}

// Per-type step variants. The action schema is now selected by the
// literal `type` field, not by first-match over a broad z.union, so an
// aiscope step that happens to match a looser schema (e.g. LoopAction,
// which only requires maxIterations) can no longer be silently reparsed
// with its fields stripped.
const NavigateStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('navigate'),
  action: NavigateActionSchema,
});
const InteractStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('interact'),
  action: InteractActionSchema,
});
const WaitStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('wait'),
  action: WaitActionSchema,
});
const ExtractStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('extract'),
  action: ExtractActionSchema,
});
const ToolCallStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('tool_call'),
  action: ToolCallActionSchema,
});
const ConditionStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('condition'),
  action: ConditionActionSchema,
});
const DownloadStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('download'),
  action: DownloadActionSchema,
});
const LoopStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('loop'),
  action: LoopActionSchema,
});
const CallStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('call'),
  action: CallActionSchema,
});
const GotoStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('goto'),
  action: GotoActionSchema,
});
const AiScopeStepSchema = z.object({
  ...baseStepFields(),
  type: z.literal('aiscope'),
  action: AiScopeActionSchema,
});

// The input type is relaxed to `unknown` to avoid TypeScript fighting the
// z.lazy() recursion with optional-vs-required default field mismatches.
// Runtime validation still enforces all constraints; only the static _input
// annotation is widened here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const StepSchema: z.ZodType<Step, z.ZodTypeDef, any> = z.lazy(() =>
  z.discriminatedUnion('type', [
    NavigateStepSchema,
    InteractStepSchema,
    WaitStepSchema,
    ExtractStepSchema,
    ToolCallStepSchema,
    ConditionStepSchema,
    DownloadStepSchema,
    LoopStepSchema,
    CallStepSchema,
    GotoStepSchema,
    AiScopeStepSchema,
  ]),
);

// ---------------------------------------------------------------------------
// Functions (reusable step blocks)
// ---------------------------------------------------------------------------

// A function parameter declaration. Similar to a top-level InputSchema but
// simpler — parameters come from the caller's `args` map, not from env/vault.
export const FunctionParameterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().default(true),
});

// A named, reusable block of steps. `steps` reuses the recursive StepSchema,
// so function bodies can contain loops, conditions, nested call steps, etc.
export const FunctionDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.array(FunctionParameterSchema).optional(),
  steps: z.array(StepSchema),
});

// ---------------------------------------------------------------------------
// Tool reference
// ---------------------------------------------------------------------------

export const ToolRefSchema = z.object({
  name: z.enum(['smscli', 'vaultcli']),
  config: z.record(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const OutputSchema = z.object({
  name: z.string(),
  type: z.enum(['file', 'text', 'screenshot', 'data']),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  headless: z.boolean().default(false),
  viewport: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  userAgent: z.string().optional(),
  defaultTimeout: z.number().default(30000),
  screenshotOnFailure: z.boolean().default(true),
  // Legacy — kept for backward compat; screenshotDir takes precedence
  artifactDir: z.string().default('./artifacts'),
  // Per-automation storage path overrides
  screenshotDir: z.string().optional(),
  videoDir: z.string().optional(),
  downloadDir: z.string().optional(),
  automationsDir: z.string().optional(),
  htmlDir: z.string().optional(),
  // Video recording
  recordVideo: z.boolean().optional(),
  videoSize: z.object({ width: z.number(), height: z.number() }).optional(),
});

// ---------------------------------------------------------------------------
// Top-level Automation
// ---------------------------------------------------------------------------

export const AutomationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    version: z.string().default('1.0.0'),
    description: z.string(),
    goal: z.string(),
    inputs: z.array(InputSchema),
    steps: z.array(StepSchema),
    functions: z.array(FunctionDefinitionSchema).optional(),
    tools: z.array(ToolRefSchema).optional(),
    outputs: z.array(OutputSchema).optional(),
    settings: SettingsSchema.optional(),
  })
  .superRefine((automation, ctx) => {
    // 1. Function names must be unique across the automation.
    const definedFunctions = new Set<string>();
    (automation.functions ?? []).forEach((fn, i) => {
      if (definedFunctions.has(fn.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate function name: "${fn.name}"`,
          path: ['functions', i, 'name'],
        });
      }
      definedFunctions.add(fn.name);
    });

    // 2. Every `call` step (anywhere in the tree) must reference a known function.
    //    Recursively walks automation.steps and each function body, descending into
    //    substeps. Templated function names (`{{varName}}`) are skipped because
    //    they only resolve at runtime.
    const isTemplate = (s: string): boolean => /\{\{[^}]+\}\}/.test(s);
    const walkSteps = (steps: Step[], basePath: (string | number)[]): void => {
      steps.forEach((step, idx) => {
        const stepPath: (string | number)[] = [...basePath, idx];

        if (step.type === 'call') {
          const action = step.action as { function: string; args?: Record<string, string> };
          if (!isTemplate(action.function) && !definedFunctions.has(action.function)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `call step "${step.id}" references unknown function "${action.function}"`,
              path: [...stepPath, 'action', 'function'],
            });
          }
        }

        if (step.type === 'condition') {
          const action = step.action as { thenCall?: string; elseCall?: string };
          if (action.thenCall && !isTemplate(action.thenCall) && !definedFunctions.has(action.thenCall)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `condition step "${step.id}" thenCall references unknown function "${action.thenCall}"`,
              path: [...stepPath, 'action', 'thenCall'],
            });
          }
          if (action.elseCall && !isTemplate(action.elseCall) && !definedFunctions.has(action.elseCall)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `condition step "${step.id}" elseCall references unknown function "${action.elseCall}"`,
              path: [...stepPath, 'action', 'elseCall'],
            });
          }
        }

        if (step.substeps && step.substeps.length > 0) {
          walkSteps(step.substeps, [...stepPath, 'substeps']);
        }
      });
    };

    walkSteps(automation.steps, ['steps']);
    (automation.functions ?? []).forEach((fn, i) => {
      walkSteps(fn.steps, ['functions', i, 'steps']);
    });

    // 3. Top-level step ids must be unique. Jump targets (goto.targetStepId /
    //    condition.thenStep / condition.elseStep) resolve against the
    //    top-level step map, so duplicates would make jumps ambiguous.
    const topLevelIds = new Set<string>();
    const duplicateTopLevelIds = new Set<string>();
    automation.steps.forEach((step, idx) => {
      if (topLevelIds.has(step.id)) {
        duplicateTopLevelIds.add(step.id);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate top-level step id "${step.id}". Top-level step ids must be unique for jump targets to be unambiguous.`,
          path: ['steps', idx, 'id'],
        });
      }
      topLevelIds.add(step.id);
    });

    // 4. Collect the set of NESTED step ids (loop substeps and function
    //    body steps) so we can reject jump targets that reference them.
    //    Jumps only make sense at the top level — mid-block targets lose
    //    iteration context and function parameter scope.
    const nestedStepIds = new Set<string>();
    const collectNestedIds = (steps: Step[]): void => {
      steps.forEach((s) => {
        if (s.substeps && s.substeps.length > 0) {
          s.substeps.forEach((sub) => {
            nestedStepIds.add(sub.id);
          });
          collectNestedIds(s.substeps);
        }
      });
    };
    collectNestedIds(automation.steps);
    (automation.functions ?? []).forEach((fn) => {
      fn.steps.forEach((s) => {
        nestedStepIds.add(s.id);
      });
      collectNestedIds(fn.steps);
    });

    // 5. Validate jump target references (literal values only — templated
    //    values resolve at runtime and are checked there). Also reject
    //    mixing thenStep+thenCall and elseStep+elseCall on a condition.
    const validateJumpTarget = (
      target: string,
      stepId: string,
      path: (string | number)[],
      fieldName: string,
    ): void => {
      if (isTemplate(target)) return;
      if (duplicateTopLevelIds.has(target)) {
        // Already flagged as a dup — don't double-report.
        return;
      }
      if (nestedStepIds.has(target) && !topLevelIds.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Step "${stepId}" ${fieldName} "${target}" points at a nested step (loop substep or function body). Jump targets must be top-level step ids.`,
          path,
        });
        return;
      }
      if (!topLevelIds.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Step "${stepId}" ${fieldName} "${target}" is not a known top-level step id.`,
          path,
        });
      }
    };

    // Walk top-level steps to find jump references (goto.targetStepId +
    // condition.thenStep / elseStep). Nested substeps' jumps are caught
    // by walkSteps below for the mutual-exclusion check only; their
    // jump targets would already fail the nested-id refinement above.
    automation.steps.forEach((step, idx) => {
      if (step.type === 'goto') {
        const action = step.action as { targetStepId: string };
        validateJumpTarget(
          action.targetStepId,
          step.id,
          ['steps', idx, 'action', 'targetStepId'],
          'goto target',
        );
      }
      if (step.type === 'condition') {
        const action = step.action as {
          thenStep?: string;
          elseStep?: string;
          thenCall?: string;
          elseCall?: string;
        };
        if (action.thenStep && action.thenCall) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `condition step "${step.id}" has both "thenStep" and "thenCall" — pick exactly one`,
            path: ['steps', idx, 'action'],
          });
        }
        if (action.elseStep && action.elseCall) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `condition step "${step.id}" has both "elseStep" and "elseCall" — pick exactly one`,
            path: ['steps', idx, 'action'],
          });
        }
        if (action.thenStep) {
          validateJumpTarget(
            action.thenStep,
            step.id,
            ['steps', idx, 'action', 'thenStep'],
            'thenStep target',
          );
        }
        if (action.elseStep) {
          validateJumpTarget(
            action.elseStep,
            step.id,
            ['steps', idx, 'action', 'elseStep'],
            'elseStep target',
          );
        }
      }
    });
  });
