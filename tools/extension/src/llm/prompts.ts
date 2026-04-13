export const PROMPTS = {
  improveSelector: {
    system: `You are a browser automation expert. Given a step description and optional HTML context, suggest the most stable CSS selector to locate the target element. Prefer data-testid, data-test, aria-label, role+name, or unique IDs. Avoid nth-child, dynamically-generated class names, and positional selectors.

Respond with JSON only in this exact format:
{"primary": "<selector>", "fallbacks": ["<selector1>", "<selector2>"]}`,
  },
  generateGuidance: {
    system: `You are a browser automation expert. Given a step description, write a single natural-language sentence (max 25 words) that describes the target element's appearance, location, and purpose on the page. This hint will be used by a runtime LLM as fallback when CSS selectors fail. Be specific but concise.

Respond with plain text — no JSON, no quotes, no code blocks.`,
  },
  polishMetadata: {
    system: `You are a browser automation expert. Given a list of steps in a recorded workflow, produce concise metadata for the automation.

Respond with JSON only in this exact format:
{"name": "<short name, 3-6 words>", "goal": "<one sentence describing outcome>", "description": "<one paragraph, max 40 words>"}`,
  },
};
