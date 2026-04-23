import type { PingResult } from './provider.interface.js';

/**
 * Translate a raw SDK error (or a network-level failure) thrown during a
 * `ping()` call into a stable, user-friendly `PingResult` with a short
 * message and a concrete remediation hint. Used by every provider's
 * `ping()` so the CLI and extension render identical error shapes
 * regardless of which SDK produced the failure.
 *
 * NEVER include secret values in any of the returned fields. The `raw`
 * field gets the error's `.message` (SDK error messages are safe) and
 * status code, but not the API key or the full request body.
 */
export function classifyPingError(args: {
  providerName: string;
  model: string;
  err: unknown;
}): PingResult {
  const { providerName, model, err } = args;

  const errObj = err as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  const status: number | undefined =
    typeof errObj?.status === 'number' ? errObj.status : undefined;
  const code = typeof errObj?.code === 'string' ? errObj.code : undefined;
  const rawMessage =
    typeof errObj?.message === 'string' ? errObj.message : String(err);

  // Network-level errors (no HTTP response at all)
  if (!status) {
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return {
        ok: false,
        providerName,
        model,
        message: `DNS lookup failed for the ${providerName} API host.`,
        hint:
          'Check your internet connection. If you configured a custom --base-url, verify the hostname is spelled correctly.',
        raw: rawMessage,
      };
    }
    if (code === 'ECONNREFUSED') {
      return {
        ok: false,
        providerName,
        model,
        message: `Connection refused by the ${providerName} API host.`,
        hint:
          'If you pointed at a local proxy or self-hosted endpoint, make sure it is actually running and listening on the configured base-url.',
        raw: rawMessage,
      };
    }
    if (
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      /timeout/i.test(rawMessage)
    ) {
      return {
        ok: false,
        providerName,
        model,
        message: `Network timeout talking to the ${providerName} API.`,
        hint:
          'Check your internet connection or corporate proxy settings. If your base-url is far away, consider increasing client timeouts.',
        raw: rawMessage,
      };
    }
    return {
      ok: false,
      providerName,
      model,
      message: `Could not reach the ${providerName} API.`,
      hint:
        'Network connectivity test failed before getting an HTTP response. Check your connection and any proxy or firewall that could be blocking outbound traffic.',
      raw: rawMessage,
    };
  }

  // HTTP response — map the common cases
  if (status === 401) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `401 Unauthorized — the ${providerName} API rejected the configured API key.`,
      hint: `Update your API key with: portalflow provider config ${providerName} --api-key <new-key>`,
      raw: rawMessage,
    };
  }
  if (status === 403) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `403 Forbidden — the ${providerName} API key is valid but lacks access to the configured model "${model}".`,
      hint: `Either pick a model your key can use, or switch API keys with: portalflow provider config ${providerName} --api-key <key>`,
      raw: rawMessage,
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
        'This usually means the configured base-url is pointing somewhere that is not actually an OpenAI-compatible API. Re-check --base-url.',
      raw: rawMessage,
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
      raw: rawMessage,
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      providerName,
      model,
      status,
      message: `${status} — the ${providerName} API is having server-side trouble.`,
      hint: `This is not your problem. Retry in a few minutes. Status page: ${providerStatusPage(providerName)}.`,
      raw: rawMessage,
    };
  }

  // Anything else — generic pass-through
  return {
    ok: false,
    providerName,
    model,
    status,
    message: `${status} from ${providerName} API during connectivity check.`,
    hint: 'Run with --log-level debug for the full SDK error, or re-check your provider config.',
    raw: rawMessage,
  };
}

function providerStatusPage(providerName: string): string {
  switch (providerName) {
    case 'anthropic':
      return 'https://status.anthropic.com';
    case 'openai':
      return 'https://status.openai.com';
    default:
      return 'the provider status page';
  }
}
