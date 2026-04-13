import type { ProviderKind } from '../shared/provider-kinds';

export interface ProviderConfig {
  kind: ProviderKind;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ExtensionConfig {
  activeProvider?: string;
  providers?: Record<string, ProviderConfig>;
}

const CONFIG_KEY = 'portalflow:config';

export async function loadConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return (result[CONFIG_KEY] as ExtensionConfig | undefined) ?? {};
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function setActiveProvider(name: string): Promise<void> {
  const config = await loadConfig();
  config.activeProvider = name;
  await saveConfig(config);
}

export async function setProviderConfig(
  name: string,
  provider: ProviderConfig,
): Promise<void> {
  const config = await loadConfig();
  config.providers ??= {};
  config.providers[name] = { ...config.providers[name], ...provider };
  await saveConfig(config);
}

export async function removeProvider(name: string): Promise<void> {
  const config = await loadConfig();
  if (!config.providers) return;
  delete config.providers[name];
  if (config.activeProvider === name) {
    delete config.activeProvider;
  }
  await saveConfig(config);
}

export async function getActiveProviderConfig(): Promise<
  { name: string; config: ProviderConfig } | null
> {
  const config = await loadConfig();
  if (!config.activeProvider) return null;
  const provider = config.providers?.[config.activeProvider];
  if (!provider) return null;
  return { name: config.activeProvider, config: provider };
}
