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
};
