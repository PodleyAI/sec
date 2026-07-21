/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";

/**
 * Return the first candidate path that exists on disk.
 *
 * Read-only fixture / mock-data assets are resolved via `import.meta.dir`
 * relative to the module's source file. After bundling, `import.meta.dir`
 * points at `dist/` rather than `src/`, so callers pass both the dev-tree
 * layout and the built-tree layout as candidates and let this helper pick
 * whichever exists at runtime.
 *
 * @throws Error listing every searched path when none exist.
 */
export function resolveAsset(candidates: readonly string[]): string {
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(`Asset not found. Searched:\n  - ${candidates.join("\n  - ")}`);
}
