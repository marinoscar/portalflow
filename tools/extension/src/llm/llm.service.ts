import { inferKind } from '../shared/provider-kinds';
import { getActiveProviderConfig } from '../storage/config.storage';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiProvider } from './openai.provider';
import type { LlmCompletionRequest, LlmCompletionResponse, LlmProvider } from './provider.interface';

export class LlmService {
  async complete(
    request: Omit<LlmCompletionRequest, 'model'> & { model?: string },
  ): Promise<LlmCompletionResponse> {
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
    const model = request.model ?? config.model;
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

    return provider.complete({ ...request, model });
  }
}
