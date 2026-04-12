import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ProviderKind } from '../llm/provider-kinds.js';

export interface ProviderConfig {
  kind?: ProviderKind;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  [key: string]: string | undefined;
}

export interface CliConfig {
  activeProvider?: string;
  providers?: Record<string, ProviderConfig>;
}

export class ConfigService {
  private readonly configDir: string;
  private readonly configFile: string;

  constructor() {
    this.configDir = join(homedir(), '.portalflow');
    this.configFile = join(this.configDir, 'config.json');
  }

  async load(): Promise<CliConfig> {
    if (!existsSync(this.configFile)) {
      return {};
    }
    const raw = await readFile(this.configFile, 'utf-8');
    return JSON.parse(raw) as CliConfig;
  }

  async save(config: CliConfig): Promise<void> {
    if (!existsSync(this.configDir)) {
      await mkdir(this.configDir, { recursive: true });
    }
    await writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
  }

  async getActiveProvider(): Promise<string | undefined> {
    const config = await this.load();
    return config.activeProvider;
  }

  async setActiveProvider(name: string): Promise<void> {
    const config = await this.load();
    config.activeProvider = name;
    await this.save(config);
  }

  async setProviderConfig(name: string, providerConfig: ProviderConfig): Promise<void> {
    const config = await this.load();
    config.providers ??= {};
    config.providers[name] = {
      ...(config.providers[name] ?? {}),
      ...providerConfig,
    };
    await this.save(config);
  }

  /**
   * Reset the entire configuration file by deleting it.
   * After this call, `load()` returns an empty config as if the CLI had never been configured.
   */
  async reset(): Promise<void> {
    if (existsSync(this.configFile)) {
      await unlink(this.configFile);
    }
  }
}
