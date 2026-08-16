/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileHandle } from "node:fs/promises";

/**
 * Sibling path a write lands on before it is renamed into place. Unique per
 * writer so two concurrent writers targeting one key cannot interleave bytes,
 * and so a crashed writer's leftovers are never mistaken for a finished
 * artifact (nothing reads a `.tmp.` name).
 *
 * The random suffix is not decoration: `pid` + millisecond alone collides for
 * two writers started in the same process within the same tick, which is
 * exactly what a concurrent sweep does.
 */
export function tmpPathFor(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Writes `chunk` in full, looping over short writes.
 *
 * `FileHandle.write` is allowed to report fewer bytes than it was handed, and
 * a caller that assumes otherwise both truncates the artifact and overcounts
 * it — the byte totals here become a `CacheRef.size` and a recorded
 * `contentLength`, so a wrong count is remembered as the archive's length.
 */
export async function writeFully(handle: FileHandle, chunk: Uint8Array): Promise<number> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten <= 0) {
      throw new Error(`Short write: 0 of ${chunk.byteLength - offset} remaining bytes accepted`);
    }
    offset += bytesWritten;
  }
  return offset;
}
