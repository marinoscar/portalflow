import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  ConfigService,
  type BrowserChannel,
  type BrowserConfig,
  type BrowserMode,
} from '../../config/config.service.js';
import {
  discoverBrowserProfiles,
  formatProfileLine,
  type BrowserProfile,
} from '../../browser/profile-inspector.js';

const MODES: Array<{ value: BrowserMode; label: string; hint: string }> = [
  {
    value: 'isolated',
    label: 'isolated',
    hint: 'fresh in-memory Chromium for every run (default)',
  },
  {
    value: 'persistent',
    label: 'persistent',
    hint: 'use a real Chrome / Brave / Edge profile (cookies + extensions persist)',
  },
];

export async function runSettingsBrowserFlow(configService: ConfigService): Promise<void> {
  const current = await configService.getBrowser();

  p.note(
    [
      `Mode:              ${current.mode ?? 'isolated (default)'}`,
      `Channel:           ${current.channel ?? pc.dim('(bundled chromium)')}`,
      `User data dir:     ${current.userDataDir ?? pc.dim('(none)')}`,
      `Profile directory: ${current.profileDirectory ?? pc.dim('(Default)')}`,
    ].join('\n'),
    'Current browser config',
  );

  const mode = await p.select<BrowserMode>({
    message: 'Browser mode:',
    initialValue: (current.mode ?? 'isolated') as BrowserMode,
    options: MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
  });
  if (p.isCancel(mode)) return;

  if (mode === 'isolated') {
    // Clear the persistent fields when the user opts out — the runtime
    // ignores them in isolated mode anyway, but leaving stale values in
    // the config file is confusing.
    await configService.setBrowser({
      mode: 'isolated',
      channel: undefined,
      userDataDir: undefined,
      profileDirectory: undefined,
    });
    p.log.success('Switched to isolated mode (fresh Chromium per run).');
    return;
  }

  // ---- Persistent mode: scan the local machine for Chrome profiles ----

  p.log.step('Scanning installed Chromium-family browsers…');
  const profiles = discoverBrowserProfiles();

  if (profiles.length === 0) {
    p.log.warn(
      'No Chromium-family browser profiles were found on this machine. ' +
        'Install Chrome, Brave, Chromium, or Edge first, then re-run this menu. ' +
        'You can also point at a custom user data directory by editing ~/.portalflow/config.json directly.',
    );
    return;
  }

  p.log.info(`Found ${profiles.length} profile${profiles.length === 1 ? '' : 's'}.`);

  // Pre-select the user's currently-configured profile if it still exists,
  // so re-running the wizard feels like editing instead of starting over.
  const findCurrent = (): BrowserProfile | undefined => {
    if (!current.userDataDir) return undefined;
    return profiles.find(
      (p) =>
        p.userDataDir === current.userDataDir &&
        (p.profileDirectory === (current.profileDirectory ?? 'Default') ||
          (!current.profileDirectory && p.profileDirectory === 'Default')),
    );
  };
  const initial = findCurrent();

  const choice = await p.select<string>({
    message: 'Choose a browser profile:',
    initialValue: initial ? profileKey(initial) : profileKey(profiles[0]!),
    options: profiles.map((profile) => ({
      value: profileKey(profile),
      label: formatProfileLine(profile),
      hint: profile === initial ? 'currently selected' : undefined,
    })),
  });
  if (p.isCancel(choice)) return;

  const picked = profiles.find((p) => profileKey(p) === choice)!;

  // Confirm — and warn explicitly about the lock issue. This is the single
  // most common failure mode for persistent mode and the user MUST know
  // about it before they hit it the first time.
  p.note(
    [
      `Browser:           ${picked.browser}`,
      `Channel:           ${picked.channel}`,
      `User data dir:     ${picked.userDataDir}`,
      `Profile directory: ${picked.profileDirectory}`,
      picked.email ? `Signed in as:      ${picked.email}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    'Selected profile',
  );

  p.log.warn(
    pc.yellow(
      'IMPORTANT: Chrome cannot open the same profile from two processes at once. ' +
        'If your normal browser is open with this profile, the automation will fail. ' +
        'Close all browser windows that use this profile before each run, or pick a profile you reserve for automation.',
    ),
  );

  const confirm = await p.confirm({
    message: 'Save this profile as the default browser for automation runs?',
    initialValue: true,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.log.info('Cancelled. No changes saved.');
    return;
  }

  const update: BrowserConfig = {
    mode: 'persistent',
    channel: picked.channel,
    userDataDir: picked.userDataDir,
    profileDirectory: picked.profileDirectory,
  };
  await configService.setBrowser(update);
  p.log.success('Browser config updated. Future runs will use this profile.');
  p.log.info(
    pc.dim(
      'Override per-run with --browser-mode isolated  or  --browser-profile-directory "<name>".',
    ),
  );
}

function profileKey(p: BrowserProfile): string {
  return `${p.userDataDir}::${p.profileDirectory}`;
}
