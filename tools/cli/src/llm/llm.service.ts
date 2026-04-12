import { ConfigService } from '../config/config.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import type {
  ActionDecision,
  ElementQuery,
  ElementResult,
  LlmProvider,
  LlmProviderConfig,
  PageContext,
} from './provider.interface.js';

const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';
const OPENAI_DEFAULT_MODEL = 'gpt-4o';

export class LlmService {
  private provider: LlmProvider | null = null;

  async initialize(): Promise<void> {
    const config = new ConfigService();
    const cfg = await config.load();

    // Determine active provider name: config file > env var
    const activeProviderName =
      cfg.activeProvider ?? process.env['PORTALFLOW_LLM_PROVIDER'];

    if (activeProviderName) {
      const providerCfg = cfg.providers?.[activeProviderName];

      if (activeProviderName === 'anthropic') {
        const apiKey =
          providerCfg?.apiKey ?? process.env['ANTHROPIC_API_KEY'];
        if (!apiKey) {
          throw new Error(
            'Anthropic API key not found. Set it via `portalflow provider config anthropic --api-key <key>` or the ANTHROPIC_API_KEY environment variable.',
          );
        }
        const llmConfig: LlmProviderConfig = {
          apiKey,
          model: providerCfg?.model ?? ANTHROPIC_DEFAULT_MODEL,
          baseUrl: providerCfg?.baseUrl,
        };
        this.provider = new AnthropicProvider(llmConfig);
        return;
      }

      if (activeProviderName === 'openai') {
        const apiKey =
          providerCfg?.apiKey ?? process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          throw new Error(
            'OpenAI API key not found. Set it via `portalflow provider config openai --api-key <key>` or the OPENAI_API_KEY environment variable.',
          );
        }
        const llmConfig: LlmProviderConfig = {
          apiKey,
          model: providerCfg?.model ?? OPENAI_DEFAULT_MODEL,
          baseUrl: providerCfg?.baseUrl,
        };
        this.provider = new OpenAiProvider(llmConfig);
        return;
      }

      throw new Error(
        `Unknown LLM provider "${activeProviderName}". Supported providers: anthropic, openai.`,
      );
    }

    // No active provider in config — fall back to env vars
    if (process.env['ANTHROPIC_API_KEY']) {
      this.provider = new AnthropicProvider({
        apiKey: process.env['ANTHROPIC_API_KEY'],
        model: ANTHROPIC_DEFAULT_MODEL,
      });
      return;
    }

    if (process.env['OPENAI_API_KEY']) {
      this.provider = new OpenAiProvider({
        apiKey: process.env['OPENAI_API_KEY'],
        model: OPENAI_DEFAULT_MODEL,
      });
      return;
    }

    throw new Error(
      'No LLM provider configured. Run `portalflow provider config <anthropic|openai> --api-key <key>` or set ANTHROPIC_API_KEY / OPENAI_API_KEY.',
    );
  }

  getProvider(): LlmProvider {
    if (!this.provider) {
      throw new Error('LlmService not initialized. Call initialize() first.');
    }
    return this.provider;
  }

  async findElement(query: ElementQuery): Promise<ElementResult> {
    return this.getProvider().findElement(query);
  }

  async decideAction(
    stepDescription: string,
    pageContext: PageContext,
    goal: string,
  ): Promise<ActionDecision> {
    return this.getProvider().decideAction(stepDescription, pageContext, goal);
  }

  async interpretPage(pageContext: PageContext, question: string): Promise<string> {
    return this.getProvider().interpretPage(pageContext, question);
  }
}
