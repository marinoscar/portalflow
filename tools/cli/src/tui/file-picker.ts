import * as p from '@clack/prompts';
import { readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ConfigService } from '../config/config.service.js';
import { resolvePaths } from '../runner/paths.js';

export interface PickedFile {
  path: string;      // absolute path
  cancelled: boolean;
}

export async function pickAutomationFile(message: string = 'Select an automation file'): Promise<PickedFile> {
  const cwd = process.cwd();

  // Resolve the configured automations directory (user config > default)
  let configuredAutomationsDir: string | undefined;
  try {
    const configService = new ConfigService();
    const cfg = await configService.load();
    const paths = resolvePaths(cfg);
    configuredAutomationsDir = isAbsolute(paths.automations)
      ? paths.automations
      : resolve(cwd, paths.automations);
  } catch {
    // Config read failure is non-fatal — fall back to hardcoded defaults
  }

  // Build search list: configured dir first, then hardcoded fallbacks
  const searchDirs: string[] = [];
  if (configuredAutomationsDir) {
    searchDirs.push(configuredAutomationsDir);
  }
  for (const fallback of [
    cwd,
    join(cwd, 'examples'),
    join(cwd, 'automations'),
    join(cwd, 'tools', 'cli', 'examples'),
  ]) {
    if (!searchDirs.includes(fallback)) {
      searchDirs.push(fallback);
    }
  }

  interface Found { path: string; mtime: number; }
  const found: Found[] = [];
  const seen = new Set<string>();

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        if (entry === 'package.json' || entry === 'package-lock.json' || entry === 'tsconfig.json') continue;
        const full = join(dir, entry);
        if (seen.has(full)) continue;
        try {
          const stat = statSync(full);
          if (stat.isFile()) {
            found.push({ path: full, mtime: stat.mtimeMs });
            seen.add(full);
          }
        } catch { /* ignore unreadable */ }
      }
    } catch { /* ignore unreadable dir */ }
  }

  // Sort by most recently modified
  found.sort((a, b) => b.mtime - a.mtime);

  // Build options — top 20 discovered + custom path + cancel
  const CUSTOM_VALUE = '__custom__';
  const options = found.slice(0, 20).map((f) => {
    const rel = relative(cwd, f.path) || f.path;
    const basename = f.path.split(/[/\\]/).pop() || f.path;
    return {
      value: f.path,
      label: basename,
      hint: rel !== basename ? rel : undefined,
    };
  });

  options.push({ value: CUSTOM_VALUE, label: 'Enter path manually...', hint: 'type an absolute or relative path' });

  if (options.length === 1) {
    // Only the custom option — no files discovered
    p.log.info('No .json files found in ./ or ./examples. Use manual path entry.');
  }

  const selected = await p.select({
    message,
    options,
  });

  if (p.isCancel(selected)) {
    return { path: '', cancelled: true };
  }

  if (selected === CUSTOM_VALUE) {
    const custom = await p.text({
      message: 'Path to automation JSON file:',
      placeholder: './automation.json',
      validate(value) {
        if (!value || !value.trim()) return 'Path is required';
        const resolved = isAbsolute(value) ? value : resolve(cwd, value);
        if (!existsSync(resolved)) return `File not found: ${resolved}`;
        return undefined;
      },
    });
    if (p.isCancel(custom)) return { path: '', cancelled: true };
    const resolved = isAbsolute(custom as string) ? (custom as string) : resolve(cwd, custom as string);
    return { path: resolved, cancelled: false };
  }

  return { path: selected as string, cancelled: false };
}
