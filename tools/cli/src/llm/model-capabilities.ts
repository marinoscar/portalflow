/**
 * Lightweight capability registry for LLM models.
 *
 * Different models and providers accept slightly different parameters. This
 * module classifies a model by name and returns flags that callers (like
 * AnthropicProvider and OpenAiProvider) use to construct requests correctly.
 *
 * Add new rules here as providers release new model families. Order matters:
 * more specific patterns should appear before broader catch-alls.
 */

export interface ModelCapabilities {
  /**
   * The parameter name used to limit output tokens.
   *
   * OpenAI's reasoning models (o1, o3, gpt-5.x, gpt-4.1) only accept
   * `max_completion_tokens`. Older OpenAI models and all other
   * OpenAI-compatible providers still accept `max_tokens`.
   */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';

  /**
   * Whether the model accepts a `system` role message.
   *
   * OpenAI's first-generation `o1` and `o1-mini` rejected system messages;
   * newer reasoning models (`o3`, `o4`, `gpt-5.x`) accept them. When false,
   * the caller should prepend the system instructions to the user message
   * instead of sending a separate system-role message.
   */
  supportsSystemMessages: boolean;

  /**
   * Whether the model accepts sampling parameters like `temperature`,
   * `top_p`, `presence_penalty`, and `frequency_penalty`.
   *
   * Reasoning models fix temperature at 1 and reject these parameters. We
   * don't currently send them, but this flag is here for future use if we
   * add tunable sampling.
   */
  supportsSamplingParams: boolean;

  /**
   * Whether the model supports `response_format: { type: 'json_object' }`.
   *
   * Not every OpenAI-compatible provider supports this. When false, the
   * caller should rely on prompt instructions ("respond with JSON only")
   * rather than the native JSON mode.
   */
  supportsJsonMode: boolean;

  /**
   * Whether the model can receive image inputs in the messages array.
   *
   * Vision-capable models can process screenshots alongside HTML and
   * accessibility tree data, which significantly improves element resolution
   * accuracy on visually complex pages.
   */
  supportsVision: boolean;
}

interface ModelRule {
  pattern: RegExp;
  description: string;
  capabilities: Partial<ModelCapabilities>;
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  maxTokensParam: 'max_tokens',
  supportsSystemMessages: true,
  supportsSamplingParams: true,
  supportsJsonMode: true,
  supportsVision: false,
};

/**
 * Ordered rules. The first matching pattern wins. Unknown models fall through
 * to DEFAULT_CAPABILITIES, which assumes an OpenAI-compatible provider.
 */
const MODEL_RULES: ModelRule[] = [
  // ---------------------------------------------------------------------------
  // Anthropic Claude families
  // ---------------------------------------------------------------------------
  {
    // Claude 4 family — matches claude-sonnet-4, claude-opus-4, claude-haiku-4
    pattern: /^claude-(sonnet|opus|haiku)-4/i,
    description: 'Anthropic Claude 4 family',
    capabilities: { supportsVision: true },
  },
  {
    // Claude 4 alternate naming (e.g., claude-4-sonnet)
    pattern: /^claude-4/i,
    description: 'Anthropic Claude 4 family (alternate naming)',
    capabilities: { supportsVision: true },
  },
  {
    // Claude 3.5 family — must come before 3 to avoid partial match
    pattern: /^claude-3-5/i,
    description: 'Anthropic Claude 3.5 family',
    capabilities: { supportsVision: true },
  },
  {
    // Claude 3 family — claude-3-opus, claude-3-sonnet, claude-3-haiku, etc.
    pattern: /^claude-3(-\d)?/i,
    description: 'Anthropic Claude 3 family (vision-capable)',
    capabilities: { supportsVision: true },
  },

  // ---------------------------------------------------------------------------
  // OpenAI reasoning models
  // ---------------------------------------------------------------------------
  {
    // First-generation OpenAI reasoning models: o1, o1-mini, o1-preview
    // These did NOT support vision or system messages.
    pattern: /^o1(-mini|-preview)?(-\d|$)/i,
    description: 'OpenAI o1 family (reasoning)',
    capabilities: {
      maxTokensParam: 'max_completion_tokens',
      supportsSystemMessages: false,
      supportsSamplingParams: false,
      supportsJsonMode: false,
      supportsVision: false,
    },
  },
  {
    // o3, o3-mini, o3-pro, o3-large, etc. — added vision in o3
    pattern: /^o3(-mini|-pro|-large)?(-\d|$)/i,
    description: 'OpenAI o3 family (reasoning)',
    capabilities: {
      maxTokensParam: 'max_completion_tokens',
      supportsSamplingParams: false,
      supportsVision: true,
    },
  },
  {
    // o4, o4-mini, etc.
    pattern: /^o4(-mini|-pro|-large)?(-\d|$)/i,
    description: 'OpenAI o4 family (reasoning)',
    capabilities: {
      maxTokensParam: 'max_completion_tokens',
      supportsSamplingParams: false,
      supportsVision: true,
    },
  },

  // ---------------------------------------------------------------------------
  // OpenAI GPT families
  // ---------------------------------------------------------------------------
  {
    // gpt-5.x family (gpt-5, gpt-5-mini, gpt-5.4-mini, etc.)
    pattern: /^gpt-5(\.\d+)?(-mini|-nano|-pro)?/i,
    description: 'OpenAI GPT-5 family',
    capabilities: {
      maxTokensParam: 'max_completion_tokens',
      supportsVision: true,
    },
  },
  {
    // gpt-4.1 and later
    pattern: /^gpt-4\.1/i,
    description: 'OpenAI GPT-4.1 family',
    capabilities: {
      maxTokensParam: 'max_completion_tokens',
      supportsVision: true,
    },
  },
  {
    // gpt-4o family (gpt-4o, gpt-4o-mini, gpt-4o-2024-05-13, etc.)
    pattern: /^gpt-4o/i,
    description: 'OpenAI GPT-4o family (vision-capable)',
    capabilities: { supportsVision: true },
  },
  {
    // gpt-4-turbo (gpt-4-turbo, gpt-4-turbo-preview, gpt-4-turbo-2024-04-09)
    pattern: /^gpt-4-turbo/i,
    description: 'OpenAI GPT-4 Turbo (vision-capable)',
    capabilities: { supportsVision: true },
  },

  // ---------------------------------------------------------------------------
  // Moonshot / Kimi vision variants
  // ---------------------------------------------------------------------------
  {
    pattern: /^(moonshot-v1-.*-vision|kimi-k2-vision|kimi-latest)/i,
    description: 'Moonshot Kimi vision variants',
    capabilities: { supportsVision: true },
  },
];

/**
 * Look up capabilities for a given model name. Unknown models get safe
 * defaults (max_tokens, full feature support, no vision).
 */
export function getModelCapabilities(model: string): ModelCapabilities {
  for (const rule of MODEL_RULES) {
    if (rule.pattern.test(model)) {
      return { ...DEFAULT_CAPABILITIES, ...rule.capabilities };
    }
  }
  return DEFAULT_CAPABILITIES;
}

/**
 * Detect whether an API error indicates that the wrong token parameter was
 * used. OpenAI's error messages include both the unsupported parameter and
 * the suggested alternative; this function recognizes both directions.
 */
export function isTokenParamError(errorText: string): {
  matched: boolean;
  shouldSwapTo?: 'max_tokens' | 'max_completion_tokens';
} {
  // Case 1: sent max_tokens, server wants max_completion_tokens
  if (
    /max_tokens.*not supported/i.test(errorText) &&
    /max_completion_tokens/i.test(errorText)
  ) {
    return { matched: true, shouldSwapTo: 'max_completion_tokens' };
  }
  // Case 2: sent max_completion_tokens, server wants max_tokens (older providers)
  if (
    /max_completion_tokens.*(not supported|unknown|unrecognized|invalid)/i.test(errorText) ||
    (/max_completion_tokens/i.test(errorText) && /unsupported_parameter|unknown_parameter/i.test(errorText))
  ) {
    return { matched: true, shouldSwapTo: 'max_tokens' };
  }
  return { matched: false };
}
