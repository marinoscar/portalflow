import { ConfigService } from '../config/config.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import { inferKind } from './provider-kinds.js';
import type {
  ActionDecision,
  ConditionEvaluation,
  ConditionQuery,
  ElementQuery,
  ElementResult,
  ItemsQuery,
  ItemsResult,
  LlmProvider,
  LlmProviderConfig,
  PageContext,
} from './provider.interface.js';

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
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
      const kind = inferKind(activeProviderName, providerCfg?.kind);

      if (kind === 'anthropic') {
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

      // kind === 'openai-compatible'
      const apiKey =
        providerCfg?.apiKey ??
        (activeProviderName === 'openai' ? process.env['OPENAI_API_KEY'] : undefined);
      const baseUrl =
        providerCfg?.baseUrl ??
        (activeProviderName === 'openai' ? 'https://api.openai.com/v1' : undefined);
      const llmConfig: LlmProviderConfig = {
        apiKey: apiKey ?? '',
        model: providerCfg?.model ?? OPENAI_DEFAULT_MODEL,
        baseUrl,
      };
      this.provider = new OpenAiProvider(llmConfig);
      return;
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
      "No LLM provider configured. Run 'portalflow provider' to launch the interactive setup, or see 'portalflow provider --help' for non-interactive configuration.",
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

  async findItems(query: ItemsQuery): Promise<ItemsResult> {
    return this.getProvider().findItems(query);
  }

  async evaluateCondition(query: ConditionQuery): Promise<ConditionEvaluation> {
    return this.getProvider().evaluateCondition(query);
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
