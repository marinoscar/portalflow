import { AutomationSchema, type Automation } from '@portalflow/schema';

/**
 * The parsed, validated shape of an assistant chat-edit response.
 * Clarifications have `proposal: null`; change responses have a populated
 * proposal whose `newAutomation` has passed AutomationSchema validation.
 */
export interface ParsedChatEditResponse {
  reply: string;
  proposal: ParsedChatProposal | null;
}

export interface ParsedChatProposal {
  summary: string;
  changes: string[];
  newAutomation: Automation;
}

/** Best-effort strip of markdown code fences around an LLM JSON payload. */
function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/** Extract the first JSON object substring from free-form text, if any. */
function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  // Try increasingly long suffixes ending on the last `}` — cheap and works
  // for most single-object LLM outputs.
  const end = text.lastIndexOf('}');
  if (end < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parses an assistant response into { reply, proposal }. Throws a
 * descriptive Error if the payload is unusable; callers are expected to
 * surface the error message in the chat UI as a parseError.
 */
export function parseChatEditResponse(rawText: string): ParsedChatEditResponse {
  const cleaned = stripFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const fallback = extractFirstObject(cleaned);
    if (!fallback) {
      throw new Error('Assistant response was not valid JSON.');
    }
    try {
      parsed = JSON.parse(fallback);
    } catch {
      throw new Error('Assistant response was not valid JSON.');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Assistant response was not a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  if (reply === '') {
    throw new Error('Assistant response is missing a non-empty "reply" field.');
  }

  const rawProposal = obj.proposal;
  if (rawProposal == null) {
    return { reply, proposal: null };
  }

  if (typeof rawProposal !== 'object') {
    throw new Error('Assistant response "proposal" must be an object or null.');
  }

  const prop = rawProposal as Record<string, unknown>;
  const summary = typeof prop.summary === 'string' ? prop.summary.trim() : '';
  if (summary === '') {
    throw new Error('Proposal is missing a non-empty "summary".');
  }

  const changesRaw = prop.changes;
  if (!Array.isArray(changesRaw) || changesRaw.length === 0) {
    throw new Error('Proposal "changes" must be a non-empty array of strings.');
  }
  const changes = changesRaw.map((c, i) => {
    if (typeof c !== 'string') {
      throw new Error(`Proposal "changes" entry ${i} is not a string.`);
    }
    return c;
  });

  const newAutomationRaw = prop.newAutomation;
  if (!newAutomationRaw || typeof newAutomationRaw !== 'object') {
    throw new Error('Proposal "newAutomation" must be an object.');
  }

  const validation = AutomationSchema.safeParse(newAutomationRaw);
  if (!validation.success) {
    const first = validation.error.issues[0];
    const path = first?.path.join('.') || '(root)';
    throw new Error(
      `Proposal "newAutomation" failed schema validation at ${path}: ${first?.message ?? 'unknown error'}`,
    );
  }

  return {
    reply,
    proposal: {
      summary,
      changes,
      newAutomation: validation.data,
    },
  };
}
