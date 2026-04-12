import * as p from '@clack/prompts';
import { readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';

export interface PickedFile {
  path: string;      // absolute path
  cancelled: boolean;
}

export async function pickAutomationFile(message: string = 'Select an automation file'): Promise<PickedFile> {
  // Discover .json files in common search locations relative to cwd
  const cwd = process.cwd();
  const searchDirs = [
    cwd,
    join(cwd, 'examples'),
    join(cwd, 'automations'),
    join(cwd, 'tools', 'cli', 'examples'),
  ];

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
