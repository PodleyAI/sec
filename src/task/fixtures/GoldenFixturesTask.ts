/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import type { GoldenFixtureMode } from "./goldenFixtures";
import { runGoldenFixtures } from "./goldenFixtures";
import { edgarGoldenFixtureDeps } from "./goldenFixtureSource";

export type GoldenFixturesTaskInput = {
  readonly mode?: GoldenFixtureMode;
  readonly force?: boolean;
};

export type GoldenFixturesTaskOutput = {
  readonly ok: number;
  readonly written: number;
  readonly failed: number;
  readonly problems: readonly string[];
};

/**
 * Reproduces or audits the committed golden fixture corpus against the pinned
 * EDGAR manifest. See `goldenFixtureManifest.ts` for why the corpus stays
 * committed rather than being fetched at test time.
 */
export class GoldenFixturesTask extends Task<GoldenFixturesTaskInput, GoldenFixturesTaskOutput> {
  static readonly type = "GoldenFixturesTask";
  static readonly category = "SEC";
  static readonly title = "Download / verify golden fixtures";
  static readonly description =
    "Reproduce or verify the committed EDGAR golden fixtures from the pinned manifest";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      mode: Type.Optional(Type.Union([Type.Literal("download"), Type.Literal("verify")])),
      force: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      ok: Type.Number(),
      written: Type.Number(),
      failed: Type.Number(),
      problems: Type.Array(Type.String()),
    });
  }

  async execute(input: GoldenFixturesTaskInput): Promise<GoldenFixturesTaskOutput> {
    const result = await runGoldenFixtures({
      mode: input.mode ?? "download",
      force: input.force,
      deps: edgarGoldenFixtureDeps((msg) => console.log(msg)),
    });
    return {
      ok: result.ok,
      written: result.written,
      failed: result.failed,
      problems: result.outcomes
        .filter((o) => o.status !== "ok" && o.status !== "written")
        .map((o) => `${o.file}: ${o.status}${o.detail ? ` — ${o.detail}` : ""}`),
    };
  }
}
