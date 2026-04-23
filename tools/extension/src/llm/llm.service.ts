import { inferKind } from '../shared/provider-kinds';
import { getActiveProviderConfig } from '../storage/config.storage';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  PingResult,
} from './provider.interface';

export class LlmService {
  async complete(
    request: Omit<LlmCompletionRequest, 'model'> & { model?: string },
  ): Promise<LlmCompletionResponse> {
    const { provider, model } = await this.resolveActiveProvider(request.model);
    return provider.complete({ ...request, model });
  }

  /**
   * Lightweight connectivity check against the active provider's API.
   * Called by the sidepanel before the first LLM-driven action of a
   * session (and on provider switch) so users see a clear banner instead
   * of a cryptic mid-flow error. Never throws.
   *
   * Returns a structured PingResult even when there is no configured
   * provider at all — the {ok: false} shape carries a message explaining
   * exactly what to do next.
   */
  async verifyConnectivity(): Promise<PingResult> {
    const active = await getActiveProviderConfig();
    if (!active) {
      return {
        ok: false,
        providerName: '(none)',
        model: '(none)',
        message: 'No LLM provider is configured in the extension.',
        hint: 'Open the PortalFlow options page and add an API key for Anthropic or OpenAI (or another OpenAI-compatible endpoint).',
      };
    }
    const { name, config } = active;
    if (!config.apiKey && name !== 'ollama') {
      return {
        ok: false,
        providerName: name,
        model: config.model ?? '(unset)',
        message: `Provider "${name}" has no API key configured.`,
        hint: `Open the PortalFlow options page and paste a valid API key for ${name}.`,
      };
    }
    const model = config.model;
    if (!model) {
      return {
        ok: false,
        providerName: name,
        model: '(unset)',
        message: `Provider "${name}" has no model configured.`,
        hint: `Open the PortalFlow options page and choose a model for ${name}.`,
      };
    }

    const kind = inferKind(name, config.kind);
    const provider: LlmProvider =
      kind === 'anthropic'
        ? new AnthropicProvider({ apiKey: config.apiKey ?? '', model, baseUrl: config.baseUrl })
        : new OpenAiProvider({ apiKey: config.apiKey ?? '', model, baseUrl: config.baseUrl });

    return provider.ping(name, model);
  }

  private async resolveActiveProvider(
    requestModel: string | undefined,
  ): Promise<{ provider: LlmProvider; model: string }> {
    const active = await getActiveProviderConfig();
    if (!active) {
      throw new Error('No LLM provider configured. Open the extension options page and add one.');
    }
    const { name, config } = active;
    if (!config.apiKey && name !== 'ollama') {
      throw new Error(
        `Provider "${name}" has no API key configured. Open the extension options page to set one.`,
      );
    }
    const model = requestModel ?? config.model;
    if (!model) {
      throw new Error(
        `Provider "${name}" has no model configured. Open the extension options page to set one.`,
      );
    }

    const kind = inferKind(name, config.kind);
    const provider: LlmProvider =
      kind === 'anthropic'
        ? new AnthropicProvider({ apiKey: config.apiKey ?? '', model, baseUrl: config.baseUrl })
        : new OpenAiProvider({ apiKey: config.apiKey ?? '', model, baseUrl: config.baseUrl });

    return { provider, model };
  }
}
