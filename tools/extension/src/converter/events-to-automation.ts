import type { Automation, Input, Step, Selectors } from '@portalflow/schema';
import type { RawEvent, RecordingSession } from '../shared/types';

const DEFAULT_ON_FAILURE = 'abort' as const;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 30000;

export function eventsToAutomation(session: RecordingSession): Automation {
  const steps: Step[] = [];
  const inputs: Input[] = [];
  const tools = new Set<'smscli' | 'vaultcli'>();

  let passwordCounter = 0;

  for (let i = 0; i < session.events.length; i++) {
    const event = session.events[i]!;
    const stepId = `step-${steps.length + 1}`;

    switch (event.kind) {
      case 'navigate':
        steps.push({
          id: stepId,
          name: `Navigate to ${truncate(event.url, 40)}`,
          type: 'navigate',
          action: { url: event.url },
          onFailure: DEFAULT_ON_FAILURE,
          maxRetries: DEFAULT_MAX_RETRIES,
          timeout: DEFAULT_TIMEOUT,
        });
        break;

      case 'click':
        steps.push({
          id: stepId,
          name: event.elementText
            ? `Click "${truncate(event.elementText, 30)}"`
            : `Click ${event.elementTag}`,
          type: 'interact',
          action: { interaction: 'click' },
          selectors: buildSelectors(event),
          onFailure: DEFAULT_ON_FAILURE,
          maxRetries: DEFAULT_MAX_RETRIES,
          timeout: DEFAULT_TIMEOUT,
        });
        // After a submit button, insert a wait-for-network-idle step
        if (event.isSubmitButton) {
          steps.push({
            id: `step-${steps.length + 1}`,
            name: 'Wait for page to settle',
            type: 'wait',
            action: { condition: 'network_idle' },
            onFailure: 'skip',
            maxRetries: 0,
            timeout: DEFAULT_TIMEOUT,
          });
        }
        break;

      case 'type': {
        if (event.fieldKind === 'password') {
          // Create a vault input and reference it — never copy the raw value
          passwordCounter++;
          const inputName = passwordCounter === 1 ? 'password' : `password${passwordCounter}`;
          inputs.push({
            name: inputName,
            type: 'secret',
            required: true,
            source: 'vaultcli',
            value: 'CHANGE_ME/secret-key',
            description: 'Password retrieved from vaultcli',
          });
          tools.add('vaultcli');
          steps.push({
            id: stepId,
            name: 'Type password',
            type: 'interact',
            action: { interaction: 'type', inputRef: inputName },
            selectors: buildSelectors(event),
            onFailure: DEFAULT_ON_FAILURE,
            maxRetries: DEFAULT_MAX_RETRIES,
            timeout: DEFAULT_TIMEOUT,
          });
        } else if (event.fieldKind === 'otp') {
          // Insert a tool_call step for OTP retrieval BEFORE the type step
          const otpStepId = stepId;
          const typeStepId = `step-${steps.length + 2}`;
          tools.add('smscli');
          steps.push({
            id: otpStepId,
            name: 'Retrieve OTP via smscli',
            type: 'tool_call',
            action: {
              tool: 'smscli',
              command: 'get-otp',
              args: { sender: '', pattern: '\\d{6}' },
              outputName: 'otpCode',
            },
            onFailure: DEFAULT_ON_FAILURE,
            maxRetries: 1,
            timeout: 120000,
          });
          steps.push({
            id: typeStepId,
            name: 'Enter OTP code',
            type: 'interact',
            action: { interaction: 'type', inputRef: 'otpCode' },
            selectors: buildSelectors(event),
            onFailure: DEFAULT_ON_FAILURE,
            maxRetries: DEFAULT_MAX_RETRIES,
            timeout: DEFAULT_TIMEOUT,
          });
        } else {
          steps.push({
            id: stepId,
            name: `Type into ${event.selector}`,
            type: 'interact',
            action: { interaction: 'type', value: event.value },
            selectors: buildSelectors(event),
            onFailure: DEFAULT_ON_FAILURE,
            maxRetries: DEFAULT_MAX_RETRIES,
            timeout: DEFAULT_TIMEOUT,
          });
        }
        break;
      }

      case 'select':
        steps.push({
          id: stepId,
          name: `Select "${event.value}"`,
          type: 'interact',
          action: { interaction: 'select', value: event.value },
          selectors: buildSelectors(event),
          onFailure: DEFAULT_ON_FAILURE,
          maxRetries: DEFAULT_MAX_RETRIES,
          timeout: DEFAULT_TIMEOUT,
        });
        break;

      case 'check':
        steps.push({
          id: stepId,
          name: 'Check checkbox',
          type: 'interact',
          action: { interaction: 'check' },
          selectors: buildSelectors(event),
          onFailure: DEFAULT_ON_FAILURE,
          maxRetries: DEFAULT_MAX_RETRIES,
          timeout: DEFAULT_TIMEOUT,
        });
        break;

      case 'uncheck':
        steps.push({
          id: stepId,
          name: 'Uncheck checkbox',
          type: 'interact',
          action: { interaction: 'uncheck' },
          selectors: buildSelectors(event),
          onFailure: DEFAULT_ON_FAILURE,
          maxRetries: DEFAULT_MAX_RETRIES,
          timeout: DEFAULT_TIMEOUT,
        });
        break;

      case 'submit':
        // Usually covered by the preceding click on a submit button; emit only if standalone
        steps.push({
          id: stepId,
          name: 'Submit form',
          type: 'wait',
          action: { condition: 'network_idle' },
          onFailure: 'skip',
          maxRetries: 0,
          timeout: DEFAULT_TIMEOUT,
        });
        break;
    }
  }

  // Renumber step IDs sequentially in case we inserted extra steps mid-loop
  steps.forEach((s, idx) => {
    s.id = `step-${idx + 1}`;
  });

  const toolsArray = Array.from(tools).map((name) => ({ name, config: {} }));

  return {
    id: crypto.randomUUID(),
    name: session.metadata.name || 'Recorded automation',
    version: '1.0.0',
    description:
      session.metadata.description || 'Captured with the PortalFlow Recorder extension',
    goal: session.metadata.goal || 'Replay the recorded browser workflow',
    inputs,
    steps,
    tools: toolsArray.length > 0 ? toolsArray : undefined,
    settings: {
      headless: false,
      defaultTimeout: 30000,
      screenshotOnFailure: true,
      artifactDir: './artifacts',
    },
  };
}

type EventWithSelectors = Extract<RawEvent, { selector: string; fallbacks: string[] }>;

function buildSelectors(event: EventWithSelectors): Selectors {
  return {
    primary: event.selector,
    fallbacks: event.fallbacks.length > 0 ? event.fallbacks : undefined,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}
