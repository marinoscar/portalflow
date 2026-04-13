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
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.config.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI-compatible API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return { text };
  }
}
