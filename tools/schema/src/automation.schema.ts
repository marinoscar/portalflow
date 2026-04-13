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

// Forward-declare the Step interface so TypeScript can resolve z.lazy() recursion.
export interface Step {
  id: string;
  name: string;
  description?: string;
  type: 'navigate' | 'interact' | 'wait' | 'extract' | 'tool_call' | 'condition' | 'download' | 'loop' | 'call';
  action: NavigateActionOutput
    | InteractActionOutput
    | WaitActionOutput
    | ExtractActionOutput
    | ToolCallActionOutput
    | ConditionActionOutput
    | DownloadActionOutput
    | LoopActionOutput
    | CallActionOutput;
  aiGuidance?: string;
  selectors?: z.output<typeof SelectorsSchema>;
  validation?: z.output<typeof ValidationSchema>;
  onFailure: 'retry' | 'skip' | 'abort';
  maxRetries: number;
  timeout: number;
  substeps?: Step[];
}

// The input type is relaxed to `unknown` to avoid TypeScript fighting the
// z.lazy() recursion with optional-vs-required default field mismatches.
// Runtime validation still enforces all constraints; only the static _input
// annotation is widened here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const StepSchema: z.ZodType<Step, z.ZodTypeDef, any> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.enum([
      'navigate', 'interact', 'wait', 'extract',
      'tool_call', 'condition', 'download', 'loop', 'call',
    ]),
    action: z.union([
      NavigateActionSchema,
      InteractActionSchema,
      WaitActionSchema,
      ExtractActionSchema,
      ToolCallActionSchema,
      ConditionActionSchema,
      DownloadActionSchema,
      LoopActionSchema,
      CallActionSchema,
    ]),
    aiGuidance: z.string().optional(),
    selectors: SelectorsSchema.optional(),
    validation: ValidationSchema.optional(),
    onFailure: z.enum(['retry', 'skip', 'abort']).default('abort'),
    maxRetries: z.number().int().min(0).default(3),
    timeout: z.number().int().min(0).default(30000),
    substeps: z.array(StepSchema).optional(),
  }),
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
  });
