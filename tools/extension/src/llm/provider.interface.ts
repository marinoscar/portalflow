/** Minimal LLM provider interface for the extension. */
export interface LlmCompletionRequest {
  system: string;
  user: string;
  model: string;
  maxTokens?: number;
}

export interface LlmCompletionResponse {
  text: string;
}

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
