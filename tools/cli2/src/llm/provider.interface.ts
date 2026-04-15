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
}

/**
 * The LLM's decision for the next iteration. `action` must be one of
 * the names in `allowedActions` OR `"done"`. `"done"` is a hint that
 * the model believes the goal is reached; the loop always re-runs the
 * successCheck before trusting it.
 */
export interface NextActionResult {
  action: string;
  selector?: string;
  value?: string;
  reasoning: string;
}

export interface LlmProvider {
  readonly name: string;

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
  interpretPage(pageContext: PageContext, question: string): Promise<string>;
  extractData(pageContext: PageContext, schema: string): Promise<unknown>;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
