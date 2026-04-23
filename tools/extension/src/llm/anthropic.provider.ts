import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmProviderConfig,
  PingResult,
} from './provider.interface';
import { classifyFetchThrow, classifyHttpPingFailure } from './ping-error';

const DEFAULT_MAX_TOKENS = 1024;

export class AnthropicProvider implements LlmProvider {
  constructor(private config: LlmProviderConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: request.model || this.config.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
    return { text };
  }

  /**
   * Cheap authenticated probe using GET /v1/models (no body, no cost).
   * A valid key returns 200; a bad key returns 401. Never throws — all
   * failures are captured in the returned PingResult.
   */
  async ping(providerName: string, model: string): Promise<PingResult> {
    const t0 = Date.now();
    try {
      const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        method: 'GET',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        return classifyHttpPingFailure({
          providerName,
          model,
          status: response.status,
          bodyText,
        });
      }
      return {
        ok: true,
        providerName,
        model,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return classifyFetchThrow({ providerName, model, err });
    }
  }
}
