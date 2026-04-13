import { homedir } from 'node:os';
import { join } from 'node:path';

const PORTALFLOW_HOME = join(homedir(), '.portalflow');

/**
 * Format a named section with its body lines, 2-space indented.
 * Returns the section as a multi-line string (no leading newline).
 */
function section(title: string, lines: string[]): string {
  return `${title}\n${lines.map((l) => `  ${l}`).join('\n')}`;
}

/**
 * Join multiple sections with a blank line between them.
 * Prepends a leading blank line so the whole block separates cleanly from the options list.
 */
function assemble(sections: string[]): string {
  return '\n\n' + sections.join('\n\n') + '\n';
}

export function topLevelHelpText(): string {
  return assemble([
    section('Description:', [
      'PortalFlow is a browser automation CLI that runs JSON-defined workflows',
      'in a real Chrome browser via Playwright, with LLM assistance for resilient',
      'element detection and decision-making when selectors fail.',
      '',
      'Run without arguments to launch an interactive menu, or use subcommands',
      'for non-interactive/scripted use.',
    ]),
    section('Quick start:', [
      'portalflow                                         Launch interactive menu (recommended for new users)',
      'portalflow provider                                Configure an LLM provider (Anthropic, OpenAI, Kimi, etc.)',
      `portalflow run ${PORTALFLOW_HOME}/automations/demo-search.json`,
      'portalflow validate automation.json',
      'portalflow settings                                Configure storage paths and video recording',
    ]),
    section('Config file location:', [
      `${PORTALFLOW_HOME}/config.json     Provider credentials, paths, video settings`,
    ]),
    section('Default storage locations:', [
      `${PORTALFLOW_HOME}/automations             Automation JSON files (file picker input)`,
      `${PORTALFLOW_HOME}/artifacts/screenshots   Step failure screenshots`,
      `${PORTALFLOW_HOME}/artifacts/videos        Browser session recordings`,
      `${PORTALFLOW_HOME}/artifacts/downloads     Files downloaded during runs`,
    ]),
    section('Environment variables:', [
      'PORTALFLOW_LLM_PROVIDER   Override the active LLM provider name',
      'ANTHROPIC_API_KEY         Fallback Anthropic API key (used if not in config)',
      'OPENAI_API_KEY            Fallback OpenAI API key (used if not in config)',
      'LOG_LEVEL                 pino log level: trace, debug, info, warn, error (default: info)',
    ]),
    section('Exit codes:', [
      '0   Success',
      '1   Error (validation failed, automation run failed, file not found, etc.)',
    ]),
    section('Interactive vs non-interactive:', [
      'Every command that takes a file argument works in both modes. Omit the argument',
      'and the CLI launches a guided TUI wizard. Pass the argument for scripting/CI use.',
    ]),
    section('See also:', [
      'portalflow run --help',
      'portalflow validate --help',
      'portalflow provider --help',
      'portalflow settings --help',
      '',
      'Full automation JSON reference:',
      '  https://github.com/marinoscar/portalflow/blob/main/docs/AUTOMATION-JSON-SPEC.md',
      '  (or docs/AUTOMATION-JSON-SPEC.md in your local checkout)',
    ]),
  ]);
}

export function runHelpText(): string {
  return assemble([
    section('Description:', [
      'Execute an automation defined in a JSON file. The browser opens in headed',
      'mode by default (per the project vision — headed runs have better',
      'compatibility with real portals). Pass --headless for CI environments.',
      '',
      'If FILE is omitted, a TUI file picker launches, discovers JSON files in',
      'the configured automations directory, and walks you through a validation,',
      'preview, and confirmation flow.',
    ]),
    section('Examples:', [
      'portalflow run                                              Launch interactive TUI (file picker + preview + confirm)',
      `portalflow run ${PORTALFLOW_HOME}/automations/demo-search.json   Run a specific automation (headed)`,
      'portalflow run automation.json --headless                   Run in headless mode (for CI/scripts)',
      'portalflow run automation.json --video                      Enable video recording for this run only',
      'portalflow run automation.json --no-video                   Force-disable video even if enabled in config',
      'portalflow run automation.json --video-dir /tmp/vids        Override video directory for this run',
      'portalflow run automation.json --screenshot-dir ./shots     Override screenshot directory',
      'portalflow run automation.json --download-dir ~/my-downloads',
      'portalflow run automation.json --automations-dir ./wf       Override automations lookup directory',
      'portalflow run automation.json --input billCount=3                 Pass an input value',
      "portalflow run automation.json --inputs-json '{\"user\":\"alice\"}'    Pass multiple inputs as JSON",
    ]),
    section('Precedence (highest wins):', [
      '1. CLI flag on this command (e.g., --video-dir)',
      '2. settings.* in the automation JSON file (e.g., settings.videoDir)',
      `3. paths.* / video.* in ${PORTALFLOW_HOME}/config.json`,
      `4. Built-in defaults under ${PORTALFLOW_HOME}/`,
    ]),
    section('Input parameters:', [
      'Automations can declare inputs (credentials, counts, URLs, etc.) that are',
      'resolved at runtime. Pass them via one of these methods:',
      '',
      '1. CLI flag (per value, repeatable):',
      '     portalflow run automation.json --input billCount=3 --input user=alice',
      '',
      '2. JSON object (for scripting):',
      "     portalflow run automation.json --inputs-json '{\"billCount\": 3, \"user\": \"alice\"}'",
      '',
      '3. Interactively:',
      '     portalflow run                  # no file — launches the TUI',
      '   The TUI detects missing required inputs and prompts you, using the',
      "   input's default value (if any) as the pre-filled value.",
      '',
      '4. Environment variables (for inputs with source="env"):',
      '     APP_USER=alice portalflow run automation.json',
      '',
      '  Inputs can also be referenced in step fields via template syntax:',
      '    "{{billCount}}"           - value or literal "{{billCount}}" if unset',
      '    "{{billCount:3}}"         - value or "3" if unset (default fallback)',
      '',
      '  When a required input cannot be resolved, the run aborts with a clear',
      '  error message suggesting --input or the interactive TUI.',
    ]),
    section('Notes:', [
      '- Before running, the automation JSON is parsed and validated against the',
      '  schema. If validation fails, the command exits with code 1 and does not',
      '  launch a browser.',
      '- Screenshots are captured automatically when a step fails (if',
      '  settings.screenshotOnFailure is true in the JSON, which is the default).',
      '- Video recording captures the entire browser session and is saved only',
      '  when the browser context closes cleanly.',
      `- First run after install bootstraps ${PORTALFLOW_HOME}/ and seeds example`,
      `  automations into ${PORTALFLOW_HOME}/automations/.`,
      '- The loop step supports bounded iteration over items (with AI-guided',
      '  discovery) or bounded repetition with an exit condition. See the full',
      '  spec at docs/AUTOMATION-JSON-SPEC.md#14-the-loop-step-in-depth for details.',
    ]),
    section('Exit codes:', [
      '0   All steps completed successfully',
      '1   Schema validation failed, automation errored, or file could not be read',
    ]),
    section('Environment variables:', [
      'PORTALFLOW_LLM_PROVIDER   Select LLM provider at runtime',
      'ANTHROPIC_API_KEY         Required if active provider is anthropic and no apiKey stored',
      'OPENAI_API_KEY            Required if active provider is openai and no apiKey stored',
      'LOG_LEVEL                 pino log level (default: info)',
    ]),
    section('See also:', [
      'portalflow validate <file>    Check JSON schema before running',
      'portalflow settings           Change default storage paths or video settings',
      'portalflow provider           Configure the LLM provider used during runs',
    ]),
  ]);
}

export function validateHelpText(): string {
  return assemble([
    section('Description:', [
      'Parse an automation JSON file and validate it against the schema. Reports',
      'detailed error locations on failure, or a summary (id, name, version,',
      'step count) on success. Does not launch a browser or consume any API quota.',
      '',
      'If FILE is omitted, a TUI file picker launches for interactive validation.',
    ]),
    section('Examples:', [
      'portalflow validate                             Launch interactive TUI file picker',
      'portalflow validate automation.json             Validate a specific file',
      `portalflow validate ${PORTALFLOW_HOME}/automations/demo-search.json`,
    ]),
    section('Schema (top-level fields):', [
      'id           Required. UUID string identifying the automation',
      'name         Required. Human-readable name',
      'version      Required. Semver string (e.g., "1.0.0")',
      'description  Required. One-line description',
      'goal         Required. What the automation is trying to achieve',
      'inputs[]     Array of input definitions (name, type, source, value)',
      'steps[]      Array of step objects (navigate, interact, wait, extract, tool_call, condition, download)',
      'tools[]      Optional. External tool references (smscli, vaultcli)',
      'outputs[]    Optional. Named outputs produced by the run',
      'settings     Optional. Browser, storage, video, and run configuration',
    ]),
    section('Exit codes:', [
      '0   Valid — file parses and matches the schema',
      '1   Invalid — parse error, missing required field, or type mismatch',
    ]),
    section('See also:', [
      'portalflow run <file>         Run the automation after validating',
      'portalflow --help             Top-level overview',
    ]),
  ]);
}

export function providerHelpText(): string {
  return assemble([
    section('Description:', [
      'Manage LLM provider configuration. PortalFlow supports Anthropic natively',
      'and any OpenAI-compatible endpoint (built-in presets for OpenAI, Kimi,',
      'DeepSeek, Groq, Mistral, Together AI, OpenRouter, and Ollama). Custom',
      'OpenAI-compatible endpoints are also supported.',
      '',
      'Running this command without a subcommand launches a guided TUI menu.',
    ]),
    section('Examples:', [
      'portalflow provider                             Launch interactive provider setup',
      'portalflow provider list                        Show all configured providers',
      'portalflow provider set kimi                    Switch the active provider',
      'portalflow provider config anthropic --api-key sk-ant-... --model claude-sonnet-4-20250514',
      'portalflow provider config openai --api-key sk-... --model gpt-4o',
      'portalflow provider config kimi --kind openai-compatible --api-key sk-... --model moonshot-v1-32k --base-url https://api.moonshot.cn/v1',
      'portalflow provider reset --yes                 Delete all provider config (destructive)',
    ]),
    section('Built-in presets (use with provider config):', [
      'anthropic     Anthropic Claude (native)',
      'openai        OpenAI (https://api.openai.com/v1)',
      'kimi          Moonshot Kimi (https://api.moonshot.cn/v1)',
      'deepseek      DeepSeek (https://api.deepseek.com/v1)',
      'groq          Groq (https://api.groq.com/openai/v1)',
      'mistral       Mistral (https://api.mistral.ai/v1)',
      'together      Together AI (https://api.together.xyz/v1)',
      'openrouter    OpenRouter (https://openrouter.ai/api/v1)',
      'ollama        Ollama local (http://localhost:11434/v1)',
    ]),
    section('Provider kinds:', [
      'anthropic           Uses the Anthropic Messages API (native)',
      'openai-compatible   Uses the OpenAI chat completions API with a configurable baseUrl',
    ]),
    section('Config file location:', [
      `${PORTALFLOW_HOME}/config.json`,
    ]),
    section('Environment variables:', [
      'PORTALFLOW_LLM_PROVIDER   Override the active provider',
      'ANTHROPIC_API_KEY         Fallback Anthropic key',
      'OPENAI_API_KEY            Fallback OpenAI key',
    ]),
    section('See also:', [
      'portalflow provider config --help',
      'portalflow provider reset --help',
      'portalflow settings                Configure storage paths and video recording',
    ]),
  ]);
}

export function providerListHelpText(): string {
  return assemble([
    section('Description:', [
      'Print the name, kind, model, and (if applicable) base URL of every',
      'configured provider. The currently active provider is marked with [active].',
    ]),
    section('Examples:', [
      'portalflow provider list',
    ]),
    section('Exit codes:', [
      '0   Always (even when no providers are configured — prints an info message)',
    ]),
    section('See also:', [
      'portalflow provider set <name>     Change which provider is active',
      'portalflow provider config <name>  Add or update a provider',
    ]),
  ]);
}

export function providerSetHelpText(): string {
  return assemble([
    section('Description:', [
      "Set the active LLM provider. The provider must already be configured",
      "(use 'portalflow provider config <name>' first).",
    ]),
    section('Examples:', [
      'portalflow provider set anthropic',
      'portalflow provider set openai',
      'portalflow provider set kimi',
    ]),
    section('Exit codes:', [
      '0   Active provider updated',
      '1   Provider name not found in config',
    ]),
    section('See also:', [
      'portalflow provider list           Show which provider is currently active',
      'portalflow provider config <name>  Add or update a provider',
    ]),
  ]);
}

export function providerConfigHelpText(): string {
  return assemble([
    section('Description:', [
      'Add or update credentials and model for a provider. Safe to run multiple',
      'times — fields you do not pass are preserved. The provider is saved to',
      `${PORTALFLOW_HOME}/config.json.`,
      '',
      'The NAME can be one of the built-in presets (anthropic, openai, kimi,',
      'deepseek, groq, mistral, together, openrouter, ollama) or any custom name.',
      'For custom names, pass --kind openai-compatible and --base-url.',
    ]),
    section('Examples:', [
      'portalflow provider config anthropic --api-key sk-ant-... --model claude-sonnet-4-20250514',
      'portalflow provider config openai --api-key sk-... --model gpt-4o',
      'portalflow provider config kimi --api-key sk-... --model moonshot-v1-32k',
      'portalflow provider config my-proxy --kind openai-compatible --api-key sk-... --model gpt-4o --base-url https://proxy.example.com/v1',
      'portalflow provider config anthropic --model claude-opus-4-5                  Just update the model, keep the existing API key',
    ]),
    section('Notes:', [
      '- The --kind flag is inferred from the name for built-in presets. You only',
      '  need to pass --kind when configuring a custom (non-preset) provider.',
      '- The --base-url flag is ignored for kind=anthropic.',
      `- API keys are stored in plain text in ${PORTALFLOW_HOME}/config.json. Protect`,
      '  that file with filesystem permissions if needed.',
    ]),
    section('Exit codes:', [
      '0   Provider configuration saved',
      '1   Invalid --kind value or other validation error',
    ]),
    section('See also:', [
      'portalflow provider list',
      'portalflow provider set <name>',
      'portalflow provider reset',
    ]),
  ]);
}

export function providerResetHelpText(): string {
  return assemble([
    section('Description:', [
      `Delete the entire ${PORTALFLOW_HOME}/config.json file — removes ALL configured`,
      'providers, all stored API keys, and the active provider selection.',
      'Destructive and irreversible.',
      '',
      'The --yes flag is REQUIRED for scripting safety. Without it, this command',
      "refuses to run and exits with code 1. For an interactive reset with a",
      "safer two-step confirmation, run 'portalflow provider' and pick",
      '"Reset all configurations" from the menu.',
    ]),
    section('Examples:', [
      'portalflow provider reset --yes                      Reset all provider config (non-interactive)',
      'portalflow provider                                  Interactive reset (two-step confirmation)',
    ]),
    section('Exit codes:', [
      '0   Reset completed (or nothing to reset)',
      '1   --yes flag missing, refused to proceed',
    ]),
  ]);
}

export function settingsHelpText(): string {
  return assemble([
    section('Description:', [
      'Manage global storage paths and video recording defaults. Running this',
      'command without a subcommand launches a guided TUI menu.',
      '',
      'Storage paths tell PortalFlow where to look for automation files and',
      'where to write screenshots, videos, and downloads. Video recording is',
      'disabled by default and can be enabled globally, per-automation, or',
      'per-run.',
    ]),
    section('Examples:', [
      'portalflow settings                                  Launch interactive settings menu',
      'portalflow settings list                             Print current paths and video config',
      'portalflow settings paths                            Print current paths (no flags)',
      'portalflow settings paths --automations ~/my-flows   Update only the automations directory',
      'portalflow settings paths --videos /data/recordings  Update only the videos directory',
      'portalflow settings video                            Print current video config (no flags)',
      'portalflow settings video --enable                   Enable video recording globally',
      'portalflow settings video --disable                  Disable video recording globally',
      'portalflow settings video --enable --width 1920 --height 1080   Enable with custom resolution',
    ]),
    section('Built-in default paths (used when not overridden):', [
      `automations    ${PORTALFLOW_HOME}/automations`,
      `screenshots    ${PORTALFLOW_HOME}/artifacts/screenshots`,
      `videos         ${PORTALFLOW_HOME}/artifacts/videos`,
      `downloads      ${PORTALFLOW_HOME}/artifacts/downloads`,
    ]),
    section('Precedence (highest wins):', [
      "1. CLI flag on 'portalflow run' (e.g., --video-dir)",
      '2. settings.* in the automation JSON file',
      `3. paths.* / video.* in ${PORTALFLOW_HOME}/config.json (set by this command group)`,
      '4. Built-in defaults',
    ]),
    section('Config file location:', [
      `${PORTALFLOW_HOME}/config.json`,
    ]),
    section('See also:', [
      'portalflow settings list --help',
      'portalflow settings paths --help',
      'portalflow settings video --help',
      'portalflow run --help                 Per-run path overrides',
    ]),
  ]);
}

export function settingsListHelpText(): string {
  return assemble([
    section('Description:', [
      'Print the current effective storage paths and video recording configuration.',
      'Shows the merged view after applying user config over built-in defaults.',
    ]),
    section('Examples:', [
      'portalflow settings list',
    ]),
    section('Exit codes:', [
      '0   Always',
    ]),
    section('See also:', [
      'portalflow settings paths',
      'portalflow settings video',
    ]),
  ]);
}

export function settingsPathsHelpText(): string {
  return assemble([
    section('Description:', [
      `View or update the storage path configuration in ${PORTALFLOW_HOME}/config.json.`,
      'Running with no flags prints the current effective paths. Running with',
      'any subset of flags updates only those paths (other values are preserved).',
    ]),
    section('Examples:', [
      'portalflow settings paths                                     Print current paths',
      'portalflow settings paths --automations ~/my-flows            Update one path',
      'portalflow settings paths --videos /data/videos --downloads /data/downloads',
      'portalflow settings paths --automations ~/flows --screenshots ~/shots --videos ~/videos --downloads ~/downloads',
    ]),
    section('Notes:', [
      '- Directories are NOT created by this command. They are auto-created at',
      "  run time the first time PortalFlow needs them.",
      "- Relative paths are resolved relative to the directory where you run",
      "  'portalflow run', not where you run this command. Prefer absolute paths.",
    ]),
    section('Exit codes:', [
      '0   Paths updated or printed',
    ]),
    section('See also:', [
      'portalflow run --help                 Per-run path overrides',
      'portalflow settings reset             Reset paths (via interactive TUI only)',
    ]),
  ]);
}

export function settingsVideoHelpText(): string {
  return assemble([
    section('Description:', [
      'View or update video recording defaults. Running with no flags prints',
      'the current video configuration. Pass --enable or --disable to toggle',
      'recording, and/or --width / --height to change resolution.',
      '',
      "Video recording uses Playwright's native recordVideo context option and",
      'saves files as .webm. Videos are written to the configured video directory',
      'only after the browser context closes cleanly — if the process is killed',
      'mid-run, the file may be empty or missing.',
    ]),
    section('Examples:', [
      'portalflow settings video                                 Print current video config',
      'portalflow settings video --enable                        Enable recording at default 1280x720',
      'portalflow settings video --enable --width 1920 --height 1080',
      'portalflow settings video --disable                       Disable recording',
    ]),
    section('Common presets:', [
      '720p   1280 x 720   (default, smallest file size)',
      '1080p  1920 x 1080  (HD quality)',
    ]),
    section('Exit codes:', [
      '0   Video config updated or printed',
      '1   Invalid --width or --height value',
    ]),
    section('See also:', [
      'portalflow run --video                Enable recording for a single run',
      'portalflow run --no-video             Disable for a single run even if enabled in config',
    ]),
  ]);
}
