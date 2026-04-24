import type { ToolDescription } from '../tools/tool.interface.js';

export interface PageContext {
  url: string;
  title: string;
  html: string;         // simplified/trimmed HTML of visible area
  screenshot?: string;  // base64 screenshot (optional)
}

export interface ElementQuery {
  description: string;  // what we're looking for (from aiGuidance or step description)
  pageContext: PageContext;
  failedSelectors?: string[]; // selectors that didn't work
}

export interface ElementResult {
  selector: string;
  confidence: number;   // 0-1
  explanation: string;
}

export interface ActionDecision {
  action: string;       // what to do
  selector?: string;    // element to act on
  value?: string;       // value to input
  reasoning: string;
}

export interface ItemsQuery {
  description: string;
  pageContext: PageContext;
  maxItems: number;
  order: 'first' | 'last' | 'newest' | 'oldest' | 'natural';
  existingSelectors?: string[];
}

export interface ItemsResult {
  items: Array<{ selector: string; confidence: number }>;
  explanation: string;
}

export interface ConditionQuery {
  question: string;       // plain-English question about the page
  pageContext: PageContext;
}

export interface ConditionEvaluation {
  result: boolean;        // true/false answer
  confidence: number;     // 0-1 confidence in the answer
  reasoning: string;      // why the AI reached this conclusion
}

/**
 * Entry in the "recent history" buffer passed to `decideNextAction` on
 * every iteration of an aiscope agent loop. Tracks what the LLM picked
 * last, whether it worked, and if not, why — so the model can adapt
 * instead of repeating a failing move.
 */
export interface AgentActionHistoryEntry {
  iteration: number;
  action: string;
  selector?: string;
  value?: string;
  /** For type actions dispatched via inputRef — records the ref name, not the actual value. */
  inputRef?: string;
  /** For tool_call actions — records the context variable name where the result was stored. */
  toolResult?: string;
  succeeded: boolean;
  error?: string;
}

/**
 * Query sent to the LLM on every iteration of an aiscope loop. The
 * provider is expected to pick one action from `allowedActions`, emit a
 * selector / value where relevant, and return a short reasoning string
 * for logging. When `pageContext.screenshot` is present, vision-capable
 * providers prepend it as an image content block.
 */
export interface NextActionQuery {
  /** The user-supplied goal string for this aiscope step. */
  goal: string;
  /** Current page state — url, title, simplified HTML, optional screenshot. */
  pageContext: PageContext;
  /** Whitelist of action names the LLM is permitted to emit. Plus "done". */
  allowedActions: string[];
  /** The last few action attempts with outcomes — bounded FIFO. */
  recentHistory: AgentActionHistoryEntry[];
  /**
   * Named inputs available for use via `inputRef` in type actions. The LLM
   * sees the names and types but NEVER the actual values — values are
   * resolved from context variables at dispatch time.
   */
  availableInputs?: Array<{
    name: string;
    /** 'string' | 'secret' | 'number' | 'boolean' */
    type: string;
    description?: string;
  }>;
  /**
   * Descriptions of all tools registered with the runner for this run.
   * Providers inject this as a "Tools available in this run" block into
   * the user message so the LLM knows what it can call via `tool_call`
   * without the automation author having to describe them in the goal.
   */
  availableTools?: ToolDescription[];
  /**
   * When true, the aiscope step has no successCheck and the LLM's `done`
   * emission is authoritative — the runner terminates immediately. When
   * false or undefined, `done` is a hint and the runner re-verifies with
   * the user's successCheck before terminating. Providers should surface
   * this to the model in the user message so it can calibrate its own
   * confidence before emitting `done`.
   */
  selfTerminating?: boolean;
  /**
   * In agent mode: the current plan the runner is executing. Providers
   * surface this to the model on every turn so the next action is chosen
   * in the context of the broader plan, not just the immediate goal.
   */
  plan?: AgentPlan;
  /**
   * In agent mode: the id of the milestone the runner considers "current".
   * The model reads this to know which step to advance, and can emit
   * `milestoneComplete: true` to move the runner's pointer forward, or
   * `replan: true` to discard the plan entirely.
   */
  currentMilestoneId?: string;
}

/**
 * A linear, ordered list of milestones describing how the LLM intends to
 * accomplish the goal. Produced once by `decidePlan` at step start and
 * (optionally) re-produced when the model emits `replan`. Each milestone
 * has a stable id the runner uses to track progress — the descriptions
 * are prose for both humans and the LLM.
 *
 * Linear (not DAG): for browser automation one page usually leads to the
 * next, so dependencies are implicit in order. Simpler prompt, easier to
 * present in the TUI, works identically on every model that can produce
 * structured JSON.
 */
export interface AgentPlan {
  /** Short plain-English summary of the plan as a whole. Shown in logs. */
  summary: string;
  milestones: Milestone[];
  /** Short explanation for the chosen shape, primarily for logs/debugging. */
  reasoning: string;
}

export interface Milestone {
  /** Stable id the runner uses to track progress ('m1', 'm2', ...). */
  id: string;
  /** Plain-English description of what completing this milestone looks like. */
  description: string;
  /**
   * Optional plain-English self-check the LLM can evaluate to decide
   * whether the milestone is done, separate from the overall goal's
   * successCheck. Not machine-validated — the LLM inspects it when
   * choosing whether to emit `milestoneComplete: true`.
   */
  doneWhen?: string;
}

/**
 * Query sent to the LLM's planning method at the start of an agent-mode
 * aiscope step (and whenever a `replan` is triggered). Contains the user's
 * goal and the initial page context so the model can build a plan that
 * reflects where the browser currently is, not a context-free decomposition.
 */
export interface PlanQuery {
  goal: string;
  pageContext: PageContext;
  allowedActions: string[];
  availableInputs?: NextActionQuery['availableInputs'];
  /**
   * Descriptions of all tools registered with the runner for this run.
   * Injected into the planner prompt so the model can reference tool_call
   * steps when building its milestone plan.
   */
  availableTools?: ToolDescription[];
  /**
   * When replanning, the old plan plus the reason the runner (or the LLM)
   * asked for a fresh one. Helps the model avoid re-emitting the same
   * broken milestones.
   */
  previousPlan?: {
    plan: AgentPlan;
    reason: string;
    attemptedMilestoneIds: string[];
  };
}

/**
 * The LLM's decision for the next iteration. `action` must be one of
 * the names in `allowedActions` OR `"done"`. `"done"` is a hint that
 * the model believes the goal is reached; the loop re-verifies the
 * successCheck before trusting it UNLESS the query was self-terminating
 * (no successCheck), in which case `done` ends the loop immediately.
 */
export interface NextActionResult {
  action: string;
  selector?: string;
  value?: string;
  /**
   * For `type` actions — references a context variable by name instead of
   * sending a literal value. The runner resolves this at dispatch time so
   * secret values are never included in LLM messages.
   */
  inputRef?: string;
  /**
   * For `tool_call` actions — carries the parsed tool and command along with
   * optional args. Populated by the runner after parsing `value` ("tool:command").
   * The LLM itself never needs to fill this field.
   */
  toolCall?: {
    tool: string;
    command: string;
    args?: Record<string, string>;
  };
  reasoning: string;
  /**
   * Agent mode only. When true, the runner marks the currentMilestoneId as
   * complete and advances the pointer to the next milestone BEFORE
   * dispatching the chosen `action`. If the action is `done`, the runner
   * treats the whole step as finished via the usual successCheck / self-
   * terminating paths. Ignored outside agent mode.
   */
  milestoneComplete?: boolean;
  /**
   * Agent mode only. When true, the runner discards the current plan, calls
   * `decidePlan` again with the current page context (passing the old plan
   * as `previousPlan`), and resumes the loop on the new plan's first
   * milestone. Subject to the `maxReplans` cap. Ignored outside agent mode.
   */
  replan?: boolean;
}

/**
 * Structured outcome of a provider connectivity check. Providers MUST NOT
 * throw from `ping()` — any network, auth, or config failure is captured
 * in the `PingFailure` shape so the caller (LlmService and ultimately the
 * CLI/extension pre-flight) can render a stable friendly message without
 * provider-specific try/catch plumbing.
 */
export type PingResult =
  | { ok: true; providerName: string; model: string; latencyMs: number }
  | {
      ok: false;
      providerName: string;
      model: string;
      /**
       * HTTP status if the provider replied (401, 403, 429, 5xx, ...).
       * Undefined for network-level errors (DNS, ECONNREFUSED, timeout).
       */
      status?: number;
      /** Short one-line summary — what went wrong in plain English. */
      message: string;
      /** Best-guess remediation hint — safe to show to the user. */
      hint: string;
      /** Raw error text for logs — NEVER include secret values. */
      raw?: string;
    };

export interface LlmProvider {
  readonly name: string;

  /**
   * Lightweight authenticated round-trip that confirms the configured
   * API key + base URL can reach the provider. Implementations should
   * pick the cheapest authenticated GET the provider supports (for
   * Anthropic / OpenAI / OpenAI-compatible: `models.list()`). MUST NOT
   * throw — any failure is returned as `{ ok: false, ... }` with a
   * user-friendly `message` and `hint`.
   */
  ping(): Promise<PingResult>;

  findElement(query: ElementQuery): Promise<ElementResult>;
  findItems(query: ItemsQuery): Promise<ItemsResult>;
  evaluateCondition(query: ConditionQuery): Promise<ConditionEvaluation>;
  decideAction(
    stepDescription: string,
    pageContext: PageContext,
    automationGoal: string,
  ): Promise<ActionDecision>;
  /**
   * Main entry point for the aiscope agent loop. Takes a richer query
   * than decideAction — it carries the allowed action whitelist and a
   * recent-history buffer — and returns a structured NextActionResult
   * the runner can dispatch directly.
   *
   * Implementations MUST send `pageContext.screenshot` as a vision
   * content block when it's present. Pure-text fallback is allowed
   * only when the provider does not support vision for the active
   * model.
   */
  decideNextAction(query: NextActionQuery): Promise<NextActionResult>;
  /**
   * Produce a linear plan for an agent-mode aiscope step. Called once at
   * step start, and again whenever the runner honors a `replan` emission
   * (within the maxReplans cap). LLM-agnostic: implementations MUST return
   * plain JSON the runner can validate with no provider-specific features.
   */
  decidePlan(query: PlanQuery): Promise<AgentPlan>;
  interpretPage(pageContext: PageContext, question: string): Promise<string>;
  extractData(pageContext: PageContext, schema: string): Promise<unknown>;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
