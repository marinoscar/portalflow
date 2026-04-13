import { getModelCapabilities, isTokenParamError } from './model-capabilities';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmProviderConfig,
} from './provider.interface';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_TOKENS = 1024;

export class OpenAiProvider implements LlmProvider {
  constructor(private config: LlmProviderConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const model = request.model || this.config.model;
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    const capabilities = getModelCapabilities(model);

    const messages = capabilities.supportsSystemMessages
      ? [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ]
      : [
          {
            role: 'user',
            content: `${request.system}\n\n---\n\n${request.user}`,
          },
        ];

    const firstAttempt = await this.makeRequest(url, {
      model,
      messages,
      [capabilities.maxTokensParam]: maxTokens,
    });

    if (firstAttempt.ok) {
      return firstAttempt.response;
    }

    // Retry with the alternative token parameter if the error looks like a
    // mismatch. This catches future model releases we haven't classified.
    const swap = isTokenParamError(firstAttempt.errorText);
    if (swap.matched && swap.shouldSwapTo) {
      console.warn(
        `[PortalFlow] Model ${model} rejected ${capabilities.maxTokensParam}, retrying with ${swap.shouldSwapTo}`,
      );
      const retryBody: Record<string, unknown> = {
        model,
        messages,
        [swap.shouldSwapTo]: maxTokens,
      };
      const retry = await this.makeRequest(url, retryBody);
      if (retry.ok) {
        return retry.response;
      }
      throw new Error(
        `OpenAI-compatible API error ${retry.status}: ${retry.errorText}`,
      );
    }

    throw new Error(
      `OpenAI-compatible API error ${firstAttempt.status}: ${firstAttempt.errorText}`,
    );
  }

  private async makeRequest(
    url: string,
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; response: LlmCompletionResponse }
    | { ok: false; status: number; errorText: string }
  > {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, status: response.status, errorText };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return { ok: true, response: { text } };
  }
}
