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

/**
 * Outcome of a provider connectivity probe. Providers MUST NOT throw
 * from `ping()` — any failure is captured here so the sidepanel banner
 * can render a stable message without per-provider error plumbing.
 */
export type PingResult =
  | { ok: true; providerName: string; model: string; latencyMs: number }
  | {
      ok: false;
      providerName: string;
      model: string;
      /** HTTP status if the provider replied; undefined for network errors. */
      status?: number;
      /** Short plain-English summary. */
      message: string;
      /** Best-guess remediation hint — safe to show to the user. */
      hint: string;
      /** Raw SDK error text for logs. NEVER the API key. */
      raw?: string;
    };

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
  /**
   * Cheap authenticated round-trip that confirms the configured API key
   * and base URL work. Implementations should never throw.
   */
  ping(providerName: string, model: string): Promise<PingResult>;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
