import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';
import { PROVIDER_PRESETS, type ProviderKind } from '../../llm/provider-kinds.js';
import { maskApiKey } from '../helpers.js';

const CUSTOM_VALUE = '__custom__';

export async function runConfigureFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providers = cfg.providers ?? {};

  // Build preset options
  const presetOptions = PROVIDER_PRESETS.map((preset) => {
    const isConfigured = !!providers[preset.id];
    const hintBase = preset.kind === 'anthropic' ? 'Native API' : (preset.baseUrl ?? '');
    const hint = isConfigured ? `${hintBase} (configured)` : hintBase;
    return {
      value: preset.id,
      label: preset.label,
      hint,
    };
  });

  // Append custom option
  const allOptions = [
    ...presetOptions,
    {
      value: CUSTOM_VALUE,
      label: 'Custom OpenAI-compatible provider',
      hint: 'Any endpoint with an OpenAI-compatible API',
    },
  ];

  const selection = await p.select({
    message: 'Which provider do you want to configure?',
    options: allOptions,
  });

  if (p.isCancel(selection)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const selectedValue = selection as string;

  let providerName: string;
  let kind: ProviderKind;
  let presetBaseUrl: string | undefined;
  let presetDefaultModel: string;
  let isOllama = false;

  if (selectedValue === CUSTOM_VALUE) {
    // Custom provider flow
    const nameInput = await p.text({
      message: 'Name for this provider (letters, digits, hyphens only):',
      validate(value) {
        if (!value.trim()) return 'Name is required';
        if (!/^[a-z0-9-]+$/.test(value.trim())) {
          return 'Name must contain only lowercase letters, digits, and hyphens';
        }
        if (value.trim() === 'anthropic') {
          return '"anthropic" is reserved for the native Anthropic preset';
        }
        return undefined;
      },
    });
    if (p.isCancel(nameInput)) {
      p.cancel('Cancelled');
      process.exit(0);
    }
    providerName = (nameInput as string).trim();
    kind = 'openai-compatible';
    presetBaseUrl = undefined;
    presetDefaultModel = '';
  } else {
    // Preset flow
    const preset = PROVIDER_PRESETS.find((pr) => pr.id === selectedValue)!;
    kind = preset.kind;
    presetBaseUrl = preset.baseUrl;
    presetDefaultModel = preset.defaultModel;
    isOllama = preset.id === 'ollama';

    const nameInput = await p.text({
      message: 'Name for this provider:',
      initialValue: preset.id,
      validate(value) {
        if (!value.trim()) return 'Name is required';
        return undefined;
      },
    });
    if (p.isCancel(nameInput)) {
      p.cancel('Cancelled');
      process.exit(0);
    }
    providerName = (nameInput as string).trim();

    if (providers[providerName]) {
      p.log.warn(`Provider "${providerName}" already exists — it will be updated.`);
    }

    if (preset.docsUrl) {
      p.log.info(`Get your API key at: ${preset.docsUrl}`);
    }
  }

  const existing = providers[providerName] ?? {};

  // Base URL (for openai-compatible)
  let baseUrl: string | undefined;
  if (kind === 'openai-compatible') {
    let baseUrlDefaultInput: string;
    if (selectedValue === CUSTOM_VALUE) {
      // Custom: require a base URL
      const baseUrlInput = await p.text({
        message: 'Base URL for the provider API:',
        placeholder: 'https://api.example.com/v1',
        initialValue: existing.baseUrl ?? '',
        validate(value) {
          if (!value.trim()) return 'Base URL is required';
          if (!/^https?:\/\//.test(value.trim())) {
            return 'Base URL must start with http:// or https://';
          }
          return undefined;
        },
      });
      if (p.isCancel(baseUrlInput)) {
        p.cancel('Cancelled');
        process.exit(0);
      }
      baseUrl = (baseUrlInput as string).trim();
    } else {
      // Preset: pre-fill with preset URL, allow override
      baseUrlDefaultInput = existing.baseUrl ?? presetBaseUrl ?? '';
      const baseUrlInput = await p.text({
        message: 'Base URL:',
        placeholder: baseUrlDefaultInput,
        defaultValue: baseUrlDefaultInput,
        initialValue: baseUrlDefaultInput,
      });
      if (p.isCancel(baseUrlInput)) {
        p.cancel('Cancelled');
        process.exit(0);
      }
      baseUrl = ((baseUrlInput as string) || baseUrlDefaultInput).trim() || undefined;
    }
  }

  // API key
  const apiKeyHint = existing.apiKey
    ? `press Enter to keep current (${maskApiKey(existing.apiKey)})`
    : isOllama
      ? 'optional — not required for local Ollama'
      : 'required';

  const apiKeyInput = await p.password({
    message: `API key (${apiKeyHint}):`,
    validate(value) {
      if (!value && !existing.apiKey && !isOllama) {
        return 'API key is required';
      }
      return undefined;
    },
  });

  if (p.isCancel(apiKeyInput)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const apiKeyRaw = (apiKeyInput as string).trim();
  const apiKey = apiKeyRaw || existing.apiKey || (isOllama ? 'not required for local Ollama' : '');

  // Model
  const modelDefault = existing.model ?? presetDefaultModel;
  const modelInput = await p.text({
    message: 'Model name:',
    placeholder: modelDefault || 'e.g. gpt-4o',
    defaultValue: modelDefault,
    initialValue: existing.model ?? modelDefault,
  });

  if (p.isCancel(modelInput)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const model = ((modelInput as string) || modelDefault).trim();

  // Save provider config
  const providerConfig: Record<string, string> = { kind, model };
  if (apiKey) providerConfig['apiKey'] = apiKey;
  if (baseUrl) providerConfig['baseUrl'] = baseUrl;
  await configService.setProviderConfig(providerName, providerConfig);

  // Offer to set as active if no active provider yet
  const freshCfg = await configService.load();
  if (!freshCfg.activeProvider) {
    const setActive = await p.confirm({
      message: `Set "${providerName}" as the active provider?`,
      initialValue: true,
    });

    if (p.isCancel(setActive)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    if (setActive) {
      await configService.setActiveProvider(providerName);
    }
  }

  // Summary note
  const displayLabel =
    selectedValue !== CUSTOM_VALUE
      ? (PROVIDER_PRESETS.find((pr) => pr.id === selectedValue)?.label ?? providerName)
      : providerName;

  const lines = [
    `Provider : ${pc.cyan(displayLabel)} (${pc.dim(providerName)})`,
    `Kind     : ${pc.yellow(kind)}`,
    `API key  : ${pc.dim(apiKey ? maskApiKey(apiKey) : '(none)')}`,
    `Model    : ${pc.green(model)}`,
  ];
  if (baseUrl) {
    lines.push(`Base URL : ${pc.dim(baseUrl)}`);
  }

  p.note(lines.join('\n'), 'Saved');
}
