import type { PingResult } from './provider.interface';

/**
 * Extension-side counterpart of tools/cli/src/llm/ping-error.ts. The
 * extension uses plain `fetch` instead of SDKs, so the error model is
 * "either the response was !ok OR the fetch itself threw a TypeError".
 * Both shapes land here and come out as a stable `PingResult`.
 *
 * NEVER include the API key or full response body — only the status
 * and a brief one-line error summary.
 */
export function classifyHttpPingFailure(args: {
  providerName: string;
  model: string;
  status: number;
  bodyText: string;
}): PingResult {
  const { providerName, model, status, bodyText } = args;
  const short = bodyText.slice(0, 200);

  if (status === 401) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `401 Unauthorized — the ${providerName} API rejected the configured API key.`,
      hint: `Update your API key in Settings → LLM provider for ${providerName}.`,
      raw: short,
    };
  }
  if (status === 403) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `403 Forbidden — the ${providerName} API key does not have access to the configured model "${model}".`,
      hint: 'Pick a model your key can use, or switch API keys in Settings → LLM provider.',
      raw: short,
    };
  }
  if (status === 404) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `404 Not Found — the ${providerName} API returned 404 on the connectivity probe.`,
      hint:
        'If you set a custom base URL, re-check it in Settings → LLM provider. The endpoint must be an OpenAI-compatible API root.',
      raw: short,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `429 Rate Limited — the ${providerName} API throttled the connectivity probe.`,
      hint:
        'Wait a moment and retry. If this persists, your account may be out of credits or over its quota.',
      raw: short,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `${status} — the ${providerName} API is having server-side trouble.`,
      hint: 'This is not your problem. Retry in a few minutes.',
      raw: short,
    };
  }

  return {
    ok: false,
    providerName,
    model,
    status,
    message: `${status} from ${providerName} API during connectivity check.`,
    hint: 'Check Settings → LLM provider. Open DevTools for the full response.',
    raw: short,
  };
}

/**
 * Classify a thrown `fetch` error — usually a `TypeError: Failed to fetch`.
 * In the extension service-worker / offscreen context, a failed fetch
 * almost always means CORS, network, or a bad base URL.
 */
export function classifyFetchThrow(args: {
  providerName: string;
  model: string;
  err: unknown;
}): PingResult {
  const { providerName, model, err } = args;
  const message = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    providerName,
    model,
    message: `Network error while reaching the ${providerName} API: ${message}`,
    hint:
      'Check your internet connection and — if you set a custom base URL — that it is reachable from the browser.',
    raw: message,
  };
}
