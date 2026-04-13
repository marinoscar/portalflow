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
  interpretPage(pageContext: PageContext, question: string): Promise<string>;
  extractData(pageContext: PageContext, schema: string): Promise<unknown>;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
