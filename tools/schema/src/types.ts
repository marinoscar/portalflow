import { z } from 'zod';
import {
  AutomationSchema,
  ConditionActionSchema,
  DownloadActionSchema,
  ExtractActionSchema,
  InputSchema,
  InteractActionSchema,
  LoopActionSchema,
  LoopExitWhenSchema,
  LoopItemsSchema,
  NavigateActionSchema,
  OutputSchema,
  SelectorsSchema,
  SettingsSchema,
  ToolCallActionSchema,
  ToolRefSchema,
  ValidationSchema,
  WaitActionSchema,
} from './automation.schema.js';

// Re-export Step directly since it is declared as an interface (not via z.infer<>) for recursion support
export type { Step } from './automation.schema.js';

export type Automation = z.infer<typeof AutomationSchema>;
export type Input = z.infer<typeof InputSchema>;
export type Selectors = z.infer<typeof SelectorsSchema>;
export type Validation = z.infer<typeof ValidationSchema>;
export type ToolRef = z.infer<typeof ToolRefSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

// Action types
export type NavigateAction = z.infer<typeof NavigateActionSchema>;
export type InteractAction = z.infer<typeof InteractActionSchema>;
export type WaitAction = z.infer<typeof WaitActionSchema>;
export type ExtractAction = z.infer<typeof ExtractActionSchema>;
export type ToolCallAction = z.infer<typeof ToolCallActionSchema>;
export type ConditionAction = z.infer<typeof ConditionActionSchema>;
export type DownloadAction = z.infer<typeof DownloadActionSchema>;
export type LoopAction = z.infer<typeof LoopActionSchema>;
export type LoopItems = z.infer<typeof LoopItemsSchema>;
export type LoopExitWhen = z.infer<typeof LoopExitWhenSchema>;

export type Action =
  | NavigateAction
  | InteractAction
  | WaitAction
  | ExtractAction
  | ToolCallAction
  | ConditionAction
  | DownloadAction
  | LoopAction;

// Convenience enums derived from the schema literals
export type InputType = Input['type'];
export type InputSource = NonNullable<Input['source']>;
export type StepType = 'navigate' | 'interact' | 'wait' | 'extract' | 'tool_call' | 'condition' | 'download' | 'loop';
export type OnFailure = 'retry' | 'skip' | 'abort';
export type InteractionType = InteractAction['interaction'];
export type WaitCondition = WaitAction['condition'];
export type ExtractTarget = ExtractAction['target'];
export type ToolName = ToolRef['name'];
export type OutputType = Output['type'];
export type ValidationCheckType = Validation['type'];
export type ConditionCheck = ConditionAction['check'];
export type DownloadTrigger = DownloadAction['trigger'];
