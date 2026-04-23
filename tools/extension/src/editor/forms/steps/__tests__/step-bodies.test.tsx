/**
 * @vitest-environment jsdom
 *
 * Smoke tests for all 11 step body components. Uses react-dom/client directly
 * (no @testing-library/react — matching the existing test pattern in this project).
 *
 * For each body:
 *   1. Render with a minimal valid action object.
 *   2. Assert at least one identifying label/text is in the DOM.
 *   3. Trigger a change on one field and assert onChange was called with the
 *      expected partial payload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Step body components
import { NavigateBody } from '../NavigateBody';
import { InteractBody } from '../InteractBody';
import { WaitBody } from '../WaitBody';
import { ExtractBody } from '../ExtractBody';
import { ToolCallBody } from '../ToolCallBody';
import { ConditionBody } from '../ConditionBody';
import { DownloadBody } from '../DownloadBody';
import { LoopBody } from '../LoopBody';
import { CallBody } from '../CallBody';
import { GotoBody } from '../GotoBody';
import { AiScopeBody } from '../AiScopeBody';

// Schema types (actions come from converter/StepForm defaultActionForType)
import type {
  NavigateAction,
  InteractAction,
  WaitAction,
  ExtractAction,
  ToolCallAction,
  ConditionAction,
  DownloadAction,
  LoopAction,
  CallAction,
  GotoAction,
  AiScopeAction,
  Automation,
} from '@portalflow/schema';

// ---------------------------------------------------------------------------
// Minimal empty automation — used by bodies that need step/function context
// ---------------------------------------------------------------------------

const EMPTY_AUTO: Automation = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'test',
  version: '1.0.0',
  description: '',
  goal: '',
  inputs: [],
  steps: [],
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let currentRoot: ReturnType<typeof createRoot> | null = null;

function setup(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function cleanup() {
  if (currentRoot) {
    act(() => {
      currentRoot!.unmount();
    });
    currentRoot = null;
  }
  if (container) {
    document.body.removeChild(container);
    container = null;
  }
}

afterEach(() => {
  cleanup();
});

/**
 * Renders a React element into a fresh container and returns the container.
 */
function render(element: React.ReactElement): HTMLDivElement {
  const c = setup();
  currentRoot = createRoot(c);
  act(() => {
    currentRoot!.render(element);
  });
  return c;
}

/**
 * Simulates a React-aware change on an input element.
 * React 18 intercepts the value setter; we use the native prototype setter
 * to bypass React's caching before firing the event.
 */
function fireInputChange(input: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Simulates a React-aware change on a textarea element.
 */
function fireTextareaChange(textarea: HTMLTextAreaElement, value: string): void {
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  act(() => {
    if (nativeTextareaSetter) {
      nativeTextareaSetter.call(textarea, value);
    } else {
      textarea.value = value;
    }
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Simulates a React-aware change on a select element.
 */
function fireSelectChange(select: HTMLSelectElement, value: string): void {
  const nativeSelectSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  )?.set;
  act(() => {
    if (nativeSelectSetter) {
      nativeSelectSetter.call(select, value);
    } else {
      select.value = value;
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// NavigateBody
// ---------------------------------------------------------------------------

describe('NavigateBody', () => {
  it('renders a URL field', () => {
    const onChange = vi.fn();
    const action: NavigateAction = { url: '' };
    const c = render(<NavigateBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('URL');
  });

  it('calls onChange with {url} when the input changes', () => {
    const onChange = vi.fn();
    const action: NavigateAction = { url: '' };
    const c = render(<NavigateBody action={action} onChange={onChange} errors={{}} />);
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    fireInputChange(input, 'https://test.com');
    expect(onChange).toHaveBeenCalledWith({ url: 'https://test.com' });
  });
});

// ---------------------------------------------------------------------------
// InteractBody
// ---------------------------------------------------------------------------

describe('InteractBody', () => {
  it('renders an Interaction select field', () => {
    const onChange = vi.fn();
    const action: InteractAction = { interaction: 'click' };
    const c = render(<InteractBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Interaction');
  });

  it('calls onChange when interaction select changes', () => {
    const onChange = vi.fn();
    const action: InteractAction = { interaction: 'click' };
    const c = render(<InteractBody action={action} onChange={onChange} errors={{}} />);
    const select = c.querySelector('select') as HTMLSelectElement;
    fireSelectChange(select, 'type');
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0][0] as Partial<InteractAction>;
    expect(call.interaction).toBe('type');
  });

  it('shows a Value field when interaction is "type"', () => {
    const onChange = vi.fn();
    const action: InteractAction = { interaction: 'type', value: '' };
    const c = render(<InteractBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Value');
    expect(c.textContent).toContain('Input ref');
  });

  it('does NOT show a Value field when interaction is "click"', () => {
    const onChange = vi.fn();
    const action: InteractAction = { interaction: 'click' };
    const c = render(<InteractBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).not.toContain('Value');
  });
});

// ---------------------------------------------------------------------------
// WaitBody
// ---------------------------------------------------------------------------

describe('WaitBody', () => {
  it('renders a Condition select field', () => {
    const onChange = vi.fn();
    const action: WaitAction = { condition: 'delay', value: '1000' };
    const c = render(<WaitBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Condition');
  });

  it('calls onChange when condition select changes', () => {
    const onChange = vi.fn();
    const action: WaitAction = { condition: 'delay', value: '1000' };
    const c = render(<WaitBody action={action} onChange={onChange} errors={{}} />);
    const select = c.querySelector('select') as HTMLSelectElement;
    fireSelectChange(select, 'selector');
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0][0] as Partial<WaitAction>;
    expect(call.condition).toBe('selector');
  });
});

// ---------------------------------------------------------------------------
// ExtractBody
// ---------------------------------------------------------------------------

describe('ExtractBody', () => {
  it('renders a Target and Output name field', () => {
    const onChange = vi.fn();
    const action: ExtractAction = { target: 'text', outputName: 'result' };
    const c = render(<ExtractBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Target');
    expect(c.textContent).toContain('Output name');
  });

  it('calls onChange with outputName when the text input changes', () => {
    const onChange = vi.fn();
    const action: ExtractAction = { target: 'text', outputName: '' };
    const c = render(<ExtractBody action={action} onChange={onChange} errors={{}} />);
    // outputName is the only text input when target != 'attribute'
    const inputs = c.querySelectorAll('input[type="text"]');
    const outputInput = inputs[0] as HTMLInputElement;
    fireInputChange(outputInput, 'myVar');
    expect(onChange).toHaveBeenCalledWith({ outputName: 'myVar' });
  });

  it('shows Attribute name field when target is "attribute"', () => {
    const onChange = vi.fn();
    const action: ExtractAction = { target: 'attribute', outputName: 'x', attribute: '' };
    const c = render(<ExtractBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Attribute name');
  });
});

// ---------------------------------------------------------------------------
// ToolCallBody
// ---------------------------------------------------------------------------

describe('ToolCallBody', () => {
  it('renders Tool and Command select fields', () => {
    const onChange = vi.fn();
    const action: ToolCallAction = { tool: 'smscli', command: 'otp-wait' };
    const c = render(<ToolCallBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Tool');
    expect(c.textContent).toContain('Command');
  });

  it('calls onChange when tool select changes', () => {
    const onChange = vi.fn();
    const action: ToolCallAction = { tool: 'smscli', command: 'otp-wait' };
    const c = render(<ToolCallBody action={action} onChange={onChange} errors={{}} />);
    const selects = c.querySelectorAll('select');
    const toolSelect = selects[0] as HTMLSelectElement;
    fireSelectChange(toolSelect, 'vaultcli');
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0][0] as Partial<ToolCallAction>;
    expect(call.tool).toBe('vaultcli');
  });
});

// ---------------------------------------------------------------------------
// ConditionBody — deterministic mode
// ---------------------------------------------------------------------------

describe('ConditionBody — deterministic mode', () => {
  it('renders "Check" field in deterministic mode', () => {
    const onChange = vi.fn();
    const action: ConditionAction = { check: 'element_exists', value: '.btn' };
    const c = render(
      <ConditionBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    expect(c.textContent).toContain('Check');
    expect(c.textContent).toContain('Deterministic check');
  });

  it('calls onChange when check select changes', () => {
    const onChange = vi.fn();
    const action: ConditionAction = { check: 'element_exists', value: '' };
    const c = render(
      <ConditionBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    // First radio is mode, then "Check" select comes from the deterministic section
    const selects = c.querySelectorAll('select');
    const checkSelect = selects[0] as HTMLSelectElement;
    fireSelectChange(checkSelect, 'url_matches');
    expect(onChange).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ConditionBody — AI mode
// ---------------------------------------------------------------------------

describe('ConditionBody — AI mode', () => {
  it('renders "AI question" textarea when ai field is set', () => {
    const onChange = vi.fn();
    const action: ConditionAction = { ai: 'Is the banner visible?' };
    const c = render(
      <ConditionBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    expect(c.textContent).toContain('AI question');
    expect(c.textContent).toContain('AI question');
  });

  it('calls onChange when AI question textarea changes', () => {
    const onChange = vi.fn();
    const action: ConditionAction = { ai: '' };
    const c = render(
      <ConditionBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
    fireTextareaChange(textarea, 'Is the modal open?');
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0][0] as Partial<ConditionAction>;
    expect(call.ai).toBe('Is the modal open?');
  });
});

// ---------------------------------------------------------------------------
// DownloadBody
// ---------------------------------------------------------------------------

describe('DownloadBody', () => {
  it('renders a Trigger select field', () => {
    const onChange = vi.fn();
    const action: DownloadAction = { trigger: 'click' };
    const c = render(<DownloadBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Trigger');
  });

  it('calls onChange when trigger select changes', () => {
    const onChange = vi.fn();
    const action: DownloadAction = { trigger: 'click' };
    const c = render(<DownloadBody action={action} onChange={onChange} errors={{}} />);
    const select = c.querySelector('select') as HTMLSelectElement;
    fireSelectChange(select, 'navigation');
    expect(onChange).toHaveBeenCalledWith({ trigger: 'navigation' });
  });
});

// ---------------------------------------------------------------------------
// LoopBody
// ---------------------------------------------------------------------------

describe('LoopBody', () => {
  it('renders Max iterations and Index variable fields', () => {
    const onChange = vi.fn();
    const action: LoopAction = { maxIterations: 10, indexVar: 'loop_index' };
    const c = render(<LoopBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Max iterations');
    expect(c.textContent).toContain('Index variable');
  });

  it('calls onChange with maxIterations when input changes to a number', () => {
    const onChange = vi.fn();
    const action: LoopAction = { maxIterations: 10, indexVar: 'loop_index' };
    const c = render(<LoopBody action={action} onChange={onChange} errors={{}} />);
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    fireInputChange(input, '5');
    expect(onChange).toHaveBeenCalledWith({ maxIterations: 5 });
  });
});

// ---------------------------------------------------------------------------
// CallBody
// ---------------------------------------------------------------------------

describe('CallBody', () => {
  it('shows "No functions defined" when automation has no functions', () => {
    const onChange = vi.fn();
    const action: CallAction = { function: '' };
    const c = render(
      <CallBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    expect(c.textContent).toContain('No functions defined');
  });

  it('renders a Function select when automation has functions', () => {
    const onChange = vi.fn();
    const action: CallAction = { function: 'doLogin' };
    const autoWithFn: Automation = {
      ...EMPTY_AUTO,
      functions: [{ name: 'doLogin', steps: [] }],
    };
    const c = render(
      <CallBody action={action} onChange={onChange} errors={{}} automation={autoWithFn} />,
    );
    expect(c.textContent).toContain('Function');
    const select = c.querySelector('select:not([disabled])') as HTMLSelectElement;
    expect(select).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GotoBody
// ---------------------------------------------------------------------------

describe('GotoBody', () => {
  it('renders Target step field', () => {
    const onChange = vi.fn();
    const action: GotoAction = { targetStepId: '' };
    const c = render(
      <GotoBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    expect(c.textContent).toContain('Target step');
  });

  it('calls onChange with targetStepId when raw text field changes', () => {
    const onChange = vi.fn();
    // Use a template value so the raw text field is shown instead of the select
    const action: GotoAction = { targetStepId: '{{myVar}}' };
    const c = render(
      <GotoBody action={action} onChange={onChange} errors={{}} automation={EMPTY_AUTO} />,
    );
    const input = c.querySelector('input[type="text"]') as HTMLInputElement;
    fireInputChange(input, '{{otherVar}}');
    expect(onChange).toHaveBeenCalledWith({ targetStepId: '{{otherVar}}' });
  });
});

// ---------------------------------------------------------------------------
// AiScopeBody — LLM (self-terminating) mode
// ---------------------------------------------------------------------------

describe('AiScopeBody — LLM mode (no successCheck)', () => {
  it('renders Goal field and shows LLM self-terminating message', () => {
    const onChange = vi.fn();
    const action: AiScopeAction = {
      goal: '',
      mode: 'fast',
      maxDurationSec: 300,
      maxIterations: 25,
      includeScreenshot: true,
      maxReplans: 2,
    };
    const c = render(<AiScopeBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Goal');
    expect(c.textContent).toContain('LLM decides');
  });

  it('calls onChange with goal when textarea changes', () => {
    const onChange = vi.fn();
    const action: AiScopeAction = {
      goal: '',
      mode: 'fast',
      maxDurationSec: 300,
      maxIterations: 25,
      includeScreenshot: true,
      maxReplans: 2,
    };
    const c = render(<AiScopeBody action={action} onChange={onChange} errors={{}} />);
    const textarea = c.querySelector('textarea') as HTMLTextAreaElement;
    fireTextareaChange(textarea, 'Dismiss the cookie banner');
    expect(onChange).toHaveBeenCalledWith({ goal: 'Dismiss the cookie banner' });
  });
});

// ---------------------------------------------------------------------------
// AiScopeBody — deterministic successCheck mode
// ---------------------------------------------------------------------------

describe('AiScopeBody — deterministic successCheck mode', () => {
  it('renders Check and Value fields when successCheck has a check field', () => {
    const onChange = vi.fn();
    const action: AiScopeAction = {
      goal: 'do something',
      mode: 'fast',
      maxDurationSec: 300,
      maxIterations: 25,
      includeScreenshot: true,
      maxReplans: 2,
      successCheck: { check: 'element_exists', value: '.done' },
    };
    const c = render(<AiScopeBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('Check');
    expect(c.textContent).toContain('Value');
    // The deterministic radio should be selected
    const radios = c.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;
    const deterministicRadio = Array.from(radios).find((r) => r.checked && r.name === 'aiscope-success-mode');
    expect(deterministicRadio).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AiScopeBody — AI successCheck mode
// ---------------------------------------------------------------------------

describe('AiScopeBody — AI successCheck mode', () => {
  it('renders AI question textarea when successCheck has an ai field', () => {
    const onChange = vi.fn();
    const action: AiScopeAction = {
      goal: 'do something',
      mode: 'fast',
      maxDurationSec: 300,
      maxIterations: 25,
      includeScreenshot: true,
      maxReplans: 2,
      successCheck: { ai: 'Is the modal gone?' },
    };
    const c = render(<AiScopeBody action={action} onChange={onChange} errors={{}} />);
    expect(c.textContent).toContain('AI question');
  });
});
