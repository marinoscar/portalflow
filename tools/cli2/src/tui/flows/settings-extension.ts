/**
 * settings-extension.ts
 *
 * Interactive TUI flow for editing the extension transport configuration.
 * Replaces the `runBrowserSettingsStub` from task 2.
 *
 * Lets the user edit:
 *   - host (default: 127.0.0.1)
 *   - port (default: 7667, validated 1024–65535)
 *   - profileMode (dedicated / real)
 *   - profileDir (only when dedicated, default: ~/.portalflow/chrome-profile)
 *   - closeWindowOnFinish (yes / no)
 *   - chromeBinary (optional override; empty = auto-detect)
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService, ExtensionConfig } from '../../config/config.service.js';
import { defaultExtensionConfig } from '../../config/config.service.js';

const DEFAULT_PROFILE_DIR = join(homedir(), '.portalflow', 'chrome-profile');

export async function runExtensionSettings(configService: ConfigService): Promise<void> {
  const cfg = await configService.load();
  const current: ExtensionConfig = cfg.extension ?? defaultExtensionConfig();

  // Show current values
  p.note(
    [
      `Host:               ${current.host}`,
      `Port:               ${current.port}`,
      `Profile mode:       ${current.profileMode}`,
      `Profile dir:        ${current.profileDir ?? pc.dim('(n/a)')}`,
      `Close on finish:    ${current.closeWindowOnFinish ? 'yes' : 'no'}`,
      `Chrome binary:      ${current.chromeBinary ?? pc.dim('(auto-detect)')}`,
    ].join('\n'),
    'Current extension config',
  );

  // --- host ---
  const hostInput = await p.text({
    message: 'Extension host (WebSocket listen address):',
    initialValue: current.host,
    placeholder: '127.0.0.1',
    validate: (v) => (v.trim() === '' ? 'Host is required' : undefined),
  });
  if (p.isCancel(hostInput)) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  // --- port ---
  const portInput = await p.text({
    message: 'Extension port (1024–65535):',
    initialValue: String(current.port),
    placeholder: '7667',
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1024 || n > 65535) return 'Port must be a number between 1024 and 65535';
      return undefined;
    },
  });
  if (p.isCancel(portInput)) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  // --- profileMode ---
  const modeChoice = await p.select<'dedicated' | 'real'>({
    message: 'Chrome profile mode:',
    initialValue: current.profileMode === 'unset' ? 'dedicated' : current.profileMode as 'dedicated' | 'real',
    options: [
      {
        value: 'dedicated' as const,
        label: 'Dedicated profile (recommended)',
        hint: 'Isolated Chrome profile at ~/.portalflow/chrome-profile/',
      },
      {
        value: 'real' as const,
        label: 'Real profile',
        hint: 'Your default Chrome profile — extension must be pre-installed',
      },
    ],
  });
  if (p.isCancel(modeChoice)) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  // --- profileDir (only for dedicated) ---
  let profileDir: string | undefined;
  if (modeChoice === 'dedicated') {
    const dirInput = await p.text({
      message: 'Dedicated Chrome profile directory:',
      initialValue: current.profileDir ?? DEFAULT_PROFILE_DIR,
      placeholder: DEFAULT_PROFILE_DIR,
      validate: (v) => (v.trim() === '' ? 'Directory path is required' : undefined),
    });
    if (p.isCancel(dirInput)) {
      p.log.info('Cancelled. No changes saved.');
      return;
    }
    profileDir = (dirInput as string).trim();
    // Create the directory so Chrome can use it immediately
    try {
      mkdirSync(profileDir, { recursive: true });
    } catch {
      // Non-fatal — Chrome will create it if needed
    }
  }

  // --- closeWindowOnFinish ---
  const closeChoice = await p.confirm({
    message: 'Close the automation window when the run finishes?',
    initialValue: current.closeWindowOnFinish,
  });
  if (p.isCancel(closeChoice)) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  // --- chromeBinary (optional) ---
  const binaryInput = await p.text({
    message: 'Chrome binary path (leave empty to auto-detect):',
    initialValue: current.chromeBinary ?? '',
    placeholder: '(auto-detect)',
  });
  if (p.isCancel(binaryInput)) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  // Build and persist update
  const update: Partial<ExtensionConfig> = {
    host: (hostInput as string).trim(),
    port: parseInt(portInput as string, 10),
    profileMode: modeChoice,
    profileDir: modeChoice === 'dedicated' ? profileDir : undefined,
    closeWindowOnFinish: closeChoice as boolean,
  };

  const binaryStr = (binaryInput as string).trim();
  if (binaryStr.length > 0) {
    update.chromeBinary = binaryStr;
  } else {
    // Clear any previous chromeBinary override
    update.chromeBinary = undefined;
  }

  await configService.setExtension(update);

  p.log.success('Extension settings saved to ~/.portalflow/config.json.');
}
