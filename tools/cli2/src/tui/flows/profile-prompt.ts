/**
 * profile-prompt.ts
 *
 * First-run prompt for Chrome profile mode selection.
 *
 * Called before launching an automation run when the user has not yet chosen
 * a profile mode (extension.profileMode === 'unset' or extension is absent).
 *
 * Idempotent: if profileMode is already 'dedicated' or 'real', returns
 * immediately with the existing config.
 */

import * as p from '@clack/prompts';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliConfig, ExtensionConfig, RealProfileSelection } from '../../config/config.service.js';
import { defaultExtensionConfig } from '../../config/config.service.js';
import type { ConfigService } from '../../config/config.service.js';
import { discoverBrowserProfiles, formatProfileLine } from '../../browser/profile-inspector.js';
import type { BrowserProfile } from '../../browser/profile-inspector.js';

const DEFAULT_PROFILE_DIR = join(homedir(), '.portalflow', 'chrome-profile');

/**
 * Run the interactive sub-flow for selecting a specific real Chrome profile.
 *
 * Discovers all Chromium-family profiles on the machine and presents a
 * `p.select` list. The user may choose a specific profile or let Chrome
 * decide (no --profile-directory flag).
 *
 * Returns the RealProfileSelection to persist, or undefined if the user
 * chose "Let Chrome decide".
 *
 * @throws {Error} if the user cancels (Ctrl+C).
 */
export async function selectRealProfile(): Promise<RealProfileSelection | undefined> {
  const profiles = discoverBrowserProfiles();

  if (profiles.length === 0) {
    p.log.warn(
      'No Chromium-family profiles found on this machine — portalflow2 will launch Chrome ' +
      'without a --profile-directory flag and use whatever profile Chrome picks. ' +
      'You may want to load the extension in a specific profile and re-run settings.',
    );
    p.log.info(
      'The PortalFlow extension must be loaded inside this specific profile via ' +
      'chrome://extensions → Load unpacked. If it\'s only installed in another ' +
      'profile, the handshake will time out.',
    );
    return undefined;
  }

  const options: Array<{ value: BrowserProfile | null; label: string; hint?: string }> = [
    ...profiles.map((prof) => ({
      value: prof as BrowserProfile | null,
      label: formatProfileLine(prof),
    })),
    {
      value: null,
      label: 'Let Chrome decide (no --profile-directory flag)',
      hint: 'Chrome opens in whatever profile it considers default',
    },
  ];

  const selection = await p.select<BrowserProfile | null>({
    message: 'Which Chrome profile should portalflow2 launch into?',
    options,
  });

  if (p.isCancel(selection)) {
    throw new Error('Profile setup cancelled. Run `portalflow2` again to configure.');
  }

  p.log.info(
    'The PortalFlow extension must be loaded inside this specific profile via ' +
    'chrome://extensions → Load unpacked. If it\'s only installed in another ' +
    'profile, the handshake will time out.',
  );

  if (selection === null) {
    return undefined;
  }

  return {
    userDataDir: selection.userDataDir,
    profileName: selection.profileDirectory,
    displayName: selection.displayName,
    browser: selection.browser,
  };
}

/**
 * Ensures the user has chosen a Chrome profile mode.
 *
 * If `config.extension.profileMode` is already 'dedicated' or 'real', returns
 * the existing ExtensionConfig immediately — no prompt is shown.
 *
 * If profileMode is 'unset' (or extension is absent), shows a @clack/prompts
 * select to let the user pick 'dedicated' or 'real', persists the choice, and
 * returns the updated ExtensionConfig.
 *
 * @throws {Error} if the user cancels (Ctrl+C) — caller should handle.
 */
export async function ensureProfileChoice(
  config: CliConfig,
  configService: ConfigService,
): Promise<ExtensionConfig> {
  const current = config.extension ?? defaultExtensionConfig();

  // Idempotent: already configured — skip the prompt.
  if (current.profileMode === 'dedicated' || current.profileMode === 'real') {
    return current;
  }

  // --- First-run prompt ---

  p.log.info(
    'PortalFlow needs to know which Chrome profile to use for automation runs.',
  );

  const choice = await p.select<'dedicated' | 'real'>({
    message: 'Which Chrome profile mode would you like to use?',
    options: [
      {
        value: 'dedicated' as const,
        label: 'Dedicated profile (recommended)',
        hint: [
          'Creates a fresh Chrome profile at ~/.portalflow/chrome-profile/ — isolated from',
          'your day-to-day browsing, safe, reproducible. You\'ll need to log into each site',
          'the first time inside this profile; the extension remembers the session thereafter.',
        ].join(' '),
      },
      {
        value: 'real' as const,
        label: 'Real profile',
        hint: [
          'Uses your existing Chrome profile with all your logins, extensions, and MFA',
          'tokens. Requires you to install the extension in that profile via',
          'chrome://extensions → Load unpacked.',
        ].join(' '),
      },
    ],
  });

  if (p.isCancel(choice)) {
    throw new Error(
      'Profile setup cancelled. Run `portalflow2` again to configure.',
    );
  }

  // Build updated config
  const updated: Partial<ExtensionConfig> = {
    ...current,
    profileMode: choice,
  };

  if (choice === 'dedicated') {
    updated.profileDir = DEFAULT_PROFILE_DIR;
    // Create the profile directory now so Chrome can write to it immediately.
    mkdirSync(DEFAULT_PROFILE_DIR, { recursive: true });
    // Clear any previous real-profile selection
    updated.realProfile = undefined;
  } else {
    // 'real' mode: run the sub-profile selector
    delete updated.profileDir;
    updated.realProfile = await selectRealProfile();
  }

  // Persist to config file
  await configService.setExtension(updated);

  p.log.success(
    `Profile mode set to ${choice}. Config saved to ~/.portalflow/config.json.`,
  );

  // Return the merged ExtensionConfig as it will be stored
  const merged: ExtensionConfig = {
    ...current,
    ...updated,
    profileMode: choice,
  };

  return merged;
}
