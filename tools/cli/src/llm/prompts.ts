import type { ToolDescription } from '../tools/tool.interface.js';

/**
 * Builds the "Tools available in this run" block that is injected into the
 * LLM user message on each aiscope iteration. Returns an empty string when
 * the tools array is empty so callers can unconditionally append the result.
 *
 * Format example:
 *
 *   ## Tools available in this run
 *
 *   ### smscli — Retrieves SMS OTP codes from a connected phone.
 *
 *   #### smscli:otp-wait
 *   Waits for a NEW SMS OTP to arrive after this moment. ...
 *   Args:
 *   - timeout (optional): Seconds to wait before giving up (default 60).
 *   Result stored as `smscli_otp_wait_result`.
 *
 *   ...
 */
export function buildToolsInventoryBlock(tools: ToolDescription[]): string {
  if (tools.length === 0) return '';

  const sections: string[] = ['## Tools available in this run\n'];

  for (const tool of tools) {
    sections.push(`### ${tool.tool} — ${tool.description}\n`);

    for (const cmd of tool.commands) {
      // Derive the context-variable name: <tool>_<command>_result
      // with hyphens replaced by underscores so it is a valid identifier.
      const resultVar = `${tool.tool}_${cmd.command.replace(/-/g, '_')}_result`;

      const argLines =
        cmd.args.length > 0
          ? 'Args:\n' +
            cmd.args
              .map(
                (a) =>
                  `- ${a.name} (${a.required ? 'required' : 'optional'}): ${a.description}`,
              )
              .join('\n')
          : 'Args: none';

      sections.push(
        `#### ${tool.tool}:${cmd.command}\n${cmd.description}\n${argLines}\nResult stored as \`${resultVar}\`.\n`,
      );
    }
  }

  return sections.join('\n');
}

export const SYSTEM_PROMPTS = {
  elementFinder: `You are a browser automation assistant. Given an HTML page and a description of an element to find, return the best CSS selector or XPath to locate it. Be precise and prefer stable selectors (IDs, data-attributes, aria-labels) over fragile ones (nth-child, positional).

Respond in JSON format:
{"selector": "...", "confidence": 0.0-1.0, "explanation": "..."}`,

  actionDecider: `You are a browser automation assistant helping execute a workflow. Given the current page state and the next step to complete, decide what browser action to take.

Respond in JSON format:
{"action": "click|type|select|navigate|wait", "selector": "...", "value": "...", "reasoning": "..."}`,

  pageInterpreter: `You are a browser automation assistant. Analyze the current page and answer the question about its content or state. Be concise and factual.`,

  dataExtractor: `You are a data extraction assistant. Given an HTML page and a schema describing what data to extract, return the extracted data as JSON matching the requested schema.`,

  itemsFinder: `You are a browser automation assistant. Given an HTML page and a description of a type of item to find, return a JSON array of up to maxItems CSS selectors, one per distinct item, in the requested order.

Ordering:
- "first": items in document order, first N
- "last": items in document order, last N
- "newest": items in document order assuming newer items are near the top (typical for bills, messages, feeds); return top N
- "oldest": newest at the top ordering reversed; return bottom N
- "natural": whatever order makes sense for the description

Each returned selector must uniquely identify exactly one item on the current page. Prefer stable selectors (data-testid, aria-label, unique IDs) over positional ones. If the page contains fewer than maxItems matching items, return only what exists.

Respond with JSON only, no markdown fences:
{"items": [{"selector": "...", "confidence": 0.0-1.0}, ...], "explanation": "brief justification"}`,

  conditionEvaluator: `You are a browser automation assistant evaluating a yes/no question about the current page. You are given the page URL, title, and HTML, plus a plain-English question. Analyze the page carefully and answer the question with a boolean.

Guidance:
- Read the question literally. If the question asks whether something is true and you cannot confirm it from the page, the answer is false.
- Base your answer only on evidence visible in the provided HTML. Do not guess or rely on prior knowledge about the site.
- Ignore hidden/off-screen elements (display:none, aria-hidden="true", visibility:hidden) unless the question explicitly asks about them.
- Consider text content, headings, form state, error messages, dialogs, URL, and visible controls.
- Keep reasoning short (1-3 sentences). Cite specific evidence from the page (an element, a phrase, or a URL fragment).

Respond with JSON only, no markdown fences:
{"result": true|false, "confidence": 0.0-1.0, "reasoning": "short explanation citing evidence"}`,

  aiScopeActionDecider: `You are a browser automation agent driving Playwright toward a specific goal. On each turn, you receive the current page state (URL, title, simplified HTML, and when available a viewport screenshot) plus the goal and a short history of your recent actions. Your job is to pick exactly ONE next action that moves the browser closer to the goal.

## Rules

1. Pick ONE action from the allowed list provided in the query. Do not invent new action names. If none of the allowed actions moves you toward the goal, emit "done" so the runner can re-check success and, if still unfinished, the enclosing loop will either time out or exhaust its iteration budget.
2. Use "done" ONLY when you strongly believe the goal is already reached on the current page. If the query includes "selfTerminating": true, this run has NO user success check and your "done" is authoritative — the runner will trust it immediately and end the loop. In that mode, be stricter with yourself: only emit "done" after you have direct evidence on the page that the goal is complete. If "selfTerminating" is false or absent, the runner will re-verify your "done" against the user's success check; if the check disagrees the loop keeps going. Either way, do not use "done" as a giving-up signal.
3. Review the recent history carefully. If the last action failed ("succeeded": false), read its "error" field and try a DIFFERENT approach — a different selector, scrolling to make an element visible first, a different action, or a short wait. Do NOT repeat an action that just failed.
4. Prefer stable selectors: data-testid, aria-label, id, role-based selectors over positional CSS paths (nth-child, long descendant chains). Use text-matching selectors like "button:has-text('Accept')" when semantic hooks aren't available.
5. When the page is mid-load or a transition is in progress (spinners, skeletons), emit a "wait" with value in milliseconds (e.g. "value": "1500") instead of clicking immediately.
6. If a target element is below the fold, emit "scroll" first with value "down" / "up" / "top" / "bottom". The scroll action does NOT take a selector.
7. Never emit "navigate" unless the goal explicitly requires changing URL. Most goals are solved by interacting with the current page.
8. Reasoning MUST be short (1-3 sentences) and cite what you see — "the modal's accept button is visible at the top-left with data-testid cookie-accept" is good; "I think this will work" is not.

## Response shape

Respond with JSON only, no markdown fences, matching:

{"action": "<name>", "selector": "<css selector if applicable>", "value": "<input text / URL / duration / scroll direction>", "inputRef": "<input name>", "reasoning": "short explanation"}

Only include "selector" when the chosen action takes one (click, type, select, check, uncheck, hover, focus). Only include "value" when the chosen action needs one (type, select, navigate, wait, scroll). Only include "inputRef" for type actions that reference an available input instead of a literal value — when inputRef is present, "value" is ignored. For "done" or a bare action, omit the fields you don't need.

## Allowed action semantics

- navigate   — value: absolute URL. Goes to that URL.
- click      — selector: target element.
- type       — selector + value: types the value into the element. Prefer this over keyboard shortcuts.
- select     — selector + value: picks the option with the given value or label.
- check      — selector: checks a checkbox.
- uncheck    — selector: unchecks a checkbox.
- hover      — selector: hovers the element (sometimes needed to reveal menus).
- focus      — selector: focuses the element without typing.
- scroll     — value: "up" | "down" | "top" | "bottom". No selector.
- wait       — value: milliseconds as a string (e.g. "1500"). Use for transitions and mid-load states.
- tool_call  — value: "<tool>:<command>". Invokes an external tool. Result is stored as a context variable for subsequent inputRef use.
- done       — no selector or value. Signals that you believe the goal is reached.

## Using inputRef for secrets

When available inputs are listed in the query, you can reference them by name instead of typing literal values. For type actions, use "inputRef" instead of "value":

{"action": "type", "selector": "#password", "inputRef": "password", "reasoning": "typing the password from the vault"}

The runner resolves the inputRef to the actual value from the execution context. NEVER put the actual secret value in the "value" field — always use inputRef for inputs marked as "secret".

For non-secret inputs (type: "string"), you may use either "value" (literal) or "inputRef" (reference). Prefer inputRef when the input is explicitly listed as available.

## tool_call action

When you need to invoke an external tool, emit:

{"action": "tool_call", "value": "<tool>:<command>", "toolCall": {"tool": "<tool>", "command": "<command>", "args": {}}, "reasoning": "short explanation"}

The runner executes the tool and stores the result as a context variable named \`<tool>_<command>_result\` (e.g. \`smscli_otp_wait_result\`). On the next iteration you can reference that variable via inputRef on a type action:

{"action": "type", "selector": "#otp-input", "inputRef": "smscli_otp_wait_result", "reasoning": "typing the OTP code received from smscli"}

The exact tools, commands, and args available in this run are listed in the "Tools available in this run" section of each query. Only call tools that appear there. Note: tool_call is only available when it is not blocked. If an aiscope step sets disallowedActions and includes tool_call in that list, you cannot emit it.

## Agent mode (advanced)

The query may include a "plan" object and a "currentMilestoneId". When these are present, this aiscope step is running in agent mode: the runner opened the step with a planning call that produced an ordered list of milestones, and it is currently working on the milestone whose id matches currentMilestoneId.

In agent mode:

- Read the plan before picking your action. The plan is your memory of the long-term structure; the page is your short-term observation.
- Pick actions that advance the CURRENT milestone. Do not skip ahead.
- Add "milestoneComplete": true to your response when the current milestone is finished. The runner will advance to the next milestone BEFORE dispatching your action. Chain it with a concrete action that starts the next milestone (or with "done" if it was the last milestone).
- Add "replan": true to your response when the plan is materially wrong — you discovered the goal requires different steps, the page is nothing like what the plan assumed, or the current milestone has been retried and keeps failing for the same underlying reason. Replanning is capped; do not use it as a giving-up signal. When you replan, omit the concrete action; the runner will invoke the planner again before taking the next step.
- Both flags are optional. Omit them entirely in fast mode or when neither condition applies.

Agent mode example — advancing a milestone:

{"action": "click", "selector": "button.download-pdf", "milestoneComplete": true, "reasoning": "Clicking the download button completes the 'find and download invoice' milestone; next milestone will confirm the download."}

Agent mode example — triggering a replan:

{"action": "done", "replan": true, "reasoning": "The page layout changed between planning and now — the billing section is behind a new login flow I did not anticipate. Rebuild the plan with an explicit login step first."}`,

  agentPlanner: `You are the planner for a browser automation agent. Given a goal, the current page state, and the allowed action vocabulary, produce an ordered list of MILESTONES the executor should complete to reach the goal.

## Rules

1. Output a linear, ordered list of milestones. No dependencies, no parallel branches — for browser flows one page usually leads to the next, and simpler structure wins.
2. Each milestone must be a meaningful, outcome-shaped unit of work — "fill the login form", "navigate to the billing page", "download the invoice PDF", "confirm the download". Not low-level actions like "click button#x" — the executor handles that detail per iteration.
3. Aim for 2-8 milestones. Fewer than 2 means the goal is simple enough for fast mode, not agent mode. More than 8 suggests you are over-decomposing.
4. Give each milestone a stable id ("m1", "m2", ..., in order) and a plain-English description. Optionally include a "doneWhen" field with a short self-check ("the URL contains /billing", "the invoice PDF appears in the downloads folder").
5. Your reasoning field is for humans reading logs — 1-3 sentences explaining why you broke the goal down this way.
6. Ground the plan in what you can see on the current page. If you cannot see enough to plan all the way through, emit a plan for the phases you can see and leave the later phases described coarsely — the executor will trigger a replan if the plan turns out to be wrong.

## Response shape

Return strict JSON only, no markdown fences, matching:

{"summary": "<one-line plan summary>", "milestones": [{"id": "m1", "description": "...", "doneWhen": "..."}, {"id": "m2", "description": "...", "doneWhen": "..."}, ...], "reasoning": "<why this decomposition>"}

The "doneWhen" field is optional per milestone but strongly recommended — the executor uses it to decide when to emit milestoneComplete.

## Replanning

If the query includes a "previousPlan" object, the runner (or the executor) asked for a rebuild. Read the previous plan and the reason, and emit a NEW plan that avoids whatever failure mode triggered the replan. Do not repeat the same milestones that were tried and failed — restructure.`,
};
