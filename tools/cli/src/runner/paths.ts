import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliConfig, PathsConfig, VideoConfig } from '../config/config.service.js';
import type { Automation } from '@portalflow/schema';

export const PORTALFLOW_HOME = join(homedir(), '.portalflow');

export const DEFAULT_PATHS = {
  automations: join(PORTALFLOW_HOME, 'automations'),
  screenshots: join(PORTALFLOW_HOME, 'artifacts', 'screenshots'),
  videos: join(PORTALFLOW_HOME, 'artifacts', 'videos'),
  downloads: join(PORTALFLOW_HOME, 'artifacts', 'downloads'),
  html: join(PORTALFLOW_HOME, 'artifacts', 'html'),
} as const;

export const DEFAULT_VIDEO = {
  enabled: false,
  width: 1280,
  height: 720,
} as const;

export interface EffectivePaths {
  automations: string;
  screenshots: string;
  videos: string;
  downloads: string;
  html: string;
}

export interface EffectiveVideo {
  enabled: boolean;
  width: number;
  height: number;
}

export interface PathOverrides {
  automations?: string;
  screenshots?: string;
  videos?: string;
  downloads?: string;
  html?: string;
}

export interface VideoOverrides {
  enabled?: boolean;
  width?: number;
  height?: number;
}

/**
 * Resolve effective storage paths using precedence:
 * CLI > automation settings > user config > built-in defaults.
 *
 * The existing `artifactDir` field is honoured as a legacy fallback for the
 * screenshots directory only (if `screenshotDir` is not explicitly set at
 * the automation level).
 */
export function resolvePaths(
  userConfig: CliConfig,
  automationSettings?: Automation['settings'],
  cliOverrides?: PathOverrides,
): EffectivePaths {
  return {
    automations:
      cliOverrides?.automations ??
      automationSettings?.automationsDir ??
      userConfig.paths?.automations ??
      DEFAULT_PATHS.automations,
    screenshots:
      cliOverrides?.screenshots ??
      (automationSettings?.screenshotDir ?? automationSettings?.artifactDir) ??
      userConfig.paths?.screenshots ??
      DEFAULT_PATHS.screenshots,
    videos:
      cliOverrides?.videos ??
      automationSettings?.videoDir ??
      userConfig.paths?.videos ??
      DEFAULT_PATHS.videos,
    downloads:
      cliOverrides?.downloads ??
      automationSettings?.downloadDir ??
      userConfig.paths?.downloads ??
      DEFAULT_PATHS.downloads,
    html:
      cliOverrides?.html ??
      automationSettings?.htmlDir ??
      userConfig.paths?.html ??
      DEFAULT_PATHS.html,
  };
}

/**
 * Resolve effective video recording config using same precedence.
 */
export function resolveVideo(
  userConfig: CliConfig,
  automationSettings?: Automation['settings'],
  cliOverrides?: VideoOverrides,
): EffectiveVideo {
  return {
    enabled:
      cliOverrides?.enabled ??
      automationSettings?.recordVideo ??
      userConfig.video?.enabled ??
      DEFAULT_VIDEO.enabled,
    width:
      cliOverrides?.width ??
      automationSettings?.videoSize?.width ??
      userConfig.video?.width ??
      DEFAULT_VIDEO.width,
    height:
      cliOverrides?.height ??
      automationSettings?.videoSize?.height ??
      userConfig.video?.height ??
      DEFAULT_VIDEO.height,
  };
}
