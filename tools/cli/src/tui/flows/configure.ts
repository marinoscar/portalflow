import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ConfigService } from '../../config/config.service.js';
import {
  SUPPORTED_PROVIDERS,
  providerDisplayName,
  defaultModelFor,
  defaultBaseUrlFor,
  maskApiKey,
} from '../helpers.js';

export async function runConfigureFlow(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const providers = cfg.providers ?? {};

  const providerChoice = await p.select({
    message: 'Which provider do you want to configure?',
    options: SUPPORTED_PROVIDERS.map((name) => ({
      value: name,
      label: providerDisplayName(name),
      hint: providers[name] ? 'already configured' : 'not yet configured',
    })),
  });

  if (p.isCancel(providerChoice)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const providerName = providerChoice as string;
  const existing = providers[providerName] ?? {};

  // API key
  const apiKeyHint = existing.apiKey
    ? `press Enter to keep current (${maskApiKey(existing.apiKey)})`
    : 'required';

  const apiKeyInput = await p.password({
    message: `API key for ${providerDisplayName(providerName)} (${apiKeyHint}):`,
    validate(value) {
      if (!value && !existing.apiKey) {
        return 'API key is required';
      }
      return undefined;
    },
  });

  if (p.isCancel(apiKeyInput)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const apiKey = (apiKeyInput as string).trim() || existing.apiKey || '';

  // Model
  const modelDefault = existing.model ?? defaultModelFor(providerName);
  const modelInput = await p.text({
    message: `Model name:`,
    placeholder: modelDefault,
    defaultValue: modelDefault,
    initialValue: existing.model ?? modelDefault,
  });

  if (p.isCancel(modelInput)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const model = ((modelInput as string) || modelDefault).trim();

  // Base URL (openai only)
  let baseUrl: string | undefined = existing.baseUrl;
  if (providerName === 'openai') {
    const baseUrlDefault = existing.baseUrl ?? defaultBaseUrlFor(providerName);
    const baseUrlInput = await p.text({
      message: 'Base URL (optional):',
      placeholder: baseUrlDefault,
      defaultValue: baseUrlDefault,
      initialValue: existing.baseUrl ?? baseUrlDefault,
    });

    if (p.isCancel(baseUrlInput)) {
      p.cancel('Cancelled');
      process.exit(0);
    }

    baseUrl = ((baseUrlInput as string) || baseUrlDefault).trim() || undefined;
  }

  // Save provider config
  const providerConfig: Record<string, string> = { apiKey, model };
  if (baseUrl) providerConfig['baseUrl'] = baseUrl;
  await configService.setProviderConfig(providerName, providerConfig);

  // Offer to set as active if no active provider yet
  const freshCfg = await configService.load();
  if (!freshCfg.activeProvider) {
    const setActive = await p.confirm({
      message: `Set ${providerDisplayName(providerName)} as the active provider?`,
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
  const lines = [
    `Provider : ${pc.cyan(providerDisplayName(providerName))}`,
    `API key  : ${pc.dim(maskApiKey(apiKey))}`,
    `Model    : ${pc.green(model)}`,
  ];
  if (baseUrl) {
    lines.push(`Base URL : ${pc.dim(baseUrl)}`);
  }

  p.note(lines.join('\n'), 'Saved');
}
