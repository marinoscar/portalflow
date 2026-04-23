import { mkdir, readdir, copyFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_PATHS, PORTALFLOW_HOME } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve to the bundled examples directory.
// Compiled output lives at tools/cli/dist/runner/bootstrap.js,
// so going up two directories reaches tools/cli/, then into examples/.
const BUNDLED_EXAMPLES_DIR = join(__dirname, '..', '..', 'examples');

export interface BootstrapResult {
  /** Directories created during this invocation. */
  createdDirs: string[];
  /** Example files copied into the automations directory. */
  seededFiles: string[];
  /** Resolved ~/.portalflow path. */
  portalflowHome: string;
}

/**
 * Ensure the default ~/.portalflow/ directory layout exists and seed the
 * automations directory with bundled examples if it is empty.
 *
 * This function is idempotent — safe to call on every CLI invocation.
 * All failures are non-fatal: the CLI must not crash because a directory
 * could not be created (e.g. read-only home directory).
 */
export async function bootstrapDefaults(): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    createdDirs: [],
    seededFiles: [],
    portalflowHome: PORTALFLOW_HOME,
  };

  // 1. Create all four default directories.
  const dirs = [
    DEFAULT_PATHS.automations,
    DEFAULT_PATHS.screenshots,
    DEFAULT_PATHS.videos,
    DEFAULT_PATHS.downloads,
  ];

  for (const dir of dirs) {
    try {
      await access(dir);
      // Directory already exists — nothing to do.
    } catch {
      try {
        await mkdir(dir, { recursive: true });
        result.createdDirs.push(dir);
      } catch {
        // Non-fatal: silently skip if we cannot create the directory.
      }
    }
  }

  // 2. Seed the automations directory with bundled examples when it has no
  //    JSON files yet.  Never overwrites files the user has already placed there.
  try {
    const existing = await readdir(DEFAULT_PATHS.automations);
    const existingJson = existing.filter((f) => f.endsWith('.json'));
    if (existingJson.length === 0) {
      try {
        const bundledFiles = await readdir(BUNDLED_EXAMPLES_DIR);
        for (const file of bundledFiles) {
          if (!file.endsWith('.json')) continue;
          const src = join(BUNDLED_EXAMPLES_DIR, file);
          const dest = join(DEFAULT_PATHS.automations, file);
          try {
            await access(dest);
            // Destination already exists — do not overwrite.
          } catch {
            try {
              await copyFile(src, dest);
              result.seededFiles.push(dest);
            } catch {
              // Non-fatal: skip files that cannot be copied.
            }
          }
        }
      } catch {
        // Bundled examples directory not found (e.g. corrupted install) — non-fatal.
      }
    }
  } catch {
    // Automations directory does not exist despite mkdir above — non-fatal.
  }

  return result;
}
