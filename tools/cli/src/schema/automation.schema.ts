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

export const ConditionActionSchema = z.object({
  check: z.enum(['element_exists', 'url_matches', 'text_contains', 'variable_equals']),
  value: z.string(),
  thenStep: z.string().optional(),
  elseStep: z.string().optional(),
});

export const DownloadActionSchema = z.object({
  trigger: z.enum(['click', 'navigation']),
  outputDir: z.string().optional(),
  expectedFilename: z.string().optional(),
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

export const StepSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['navigate', 'interact', 'wait', 'extract', 'tool_call', 'condition', 'download']),
  action: z.union([
    NavigateActionSchema,
    InteractActionSchema,
    WaitActionSchema,
    ExtractActionSchema,
    ToolCallActionSchema,
    ConditionActionSchema,
    DownloadActionSchema,
  ]),
  aiGuidance: z.string().optional(),
  selectors: SelectorsSchema.optional(),
  validation: ValidationSchema.optional(),
  onFailure: z.enum(['retry', 'skip', 'abort']).default('abort'),
  maxRetries: z.number().int().min(0).default(3),
  timeout: z.number().int().min(0).default(30000),
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
  artifactDir: z.string().default('./artifacts'),
});

// ---------------------------------------------------------------------------
// Top-level Automation
// ---------------------------------------------------------------------------

export const AutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string(),
  goal: z.string(),
  inputs: z.array(InputSchema),
  steps: z.array(StepSchema),
  tools: z.array(ToolRefSchema).optional(),
  outputs: z.array(OutputSchema).optional(),
  settings: SettingsSchema.optional(),
});
