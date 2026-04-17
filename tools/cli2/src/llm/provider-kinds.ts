export type ProviderKind = 'anthropic' | 'openai-compatible';

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  defaultModel: string;
  docsUrl?: string;
  description?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    docsUrl: 'https://console.anthropic.com',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'kimi',
    label: 'Moonshot Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-32k',
    docsUrl: 'https://platform.moonshot.cn',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    docsUrl: 'https://console.mistral.ai',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    docsUrl: 'https://api.together.ai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.3',
    description: 'No API key required for local Ollama',
  },
];

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Infer the provider kind from a stored kind string or the provider name.
 * Used for backward compatibility when upgrading existing configs that lack a `kind` field.
 */
export function inferKind(name: string, storedKind?: string): ProviderKind {
  if (storedKind === 'anthropic' || storedKind === 'openai-compatible') {
    return storedKind;
  }
  if (name === 'anthropic') {
    return 'anthropic';
  }
  const preset = getPresetById(name);
  if (preset) {
    return preset.kind;
  }
  return 'openai-compatible';
}
