/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cheapest-first search: for each golden S-1 extractor, find the cheapest
 * (model, effort) that scores 100% agreement / recall / precision with all
 * runs ok against committed golden labels.
 *
 * Per model: try medium → high → ultra. On a hit, dial down through low/none.
 * If medium and high both stay under 98% with <2pp gain, skip remaining
 * efforts on that model.
 *
 * Usage:
 *   bun src/eval/optimizeS1Effort.ts
 *   bun src/eval/optimizeS1Effort.ts --extractors spac-sponsors,management
 *   bun src/eval/optimizeS1Effort.ts --resume
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractorsWithGoldenLabels } from "./goldenS1Labels";

const DEEPSEEK = "open-router:deepinfra:deepseek-v4-flash-0731";

/** Models cheapest → dearest (list-price order; OpenRouter stated cost still wins in the table). */
const MODELS = [
  DEEPSEEK,
  "gpt-5.6-luna",
  "claude-haiku-4-5",
  "grok-4.6",
  "gpt-5.6-terra",
  "claude-sonnet-5",
  "gpt-5.6-sol",
  "claude-opus-5",
] as const;

/** Escalate first; dial-down only after a perfect hit. */
const ESCALATE = ["medium", "high", "ultra"] as const;
const DIAL_DOWN = ["low", "none"] as const;

const OUT_DIR = join(import.meta.dir, "../../.sec-eval");
const RESULTS_PATH = join(OUT_DIR, "s1-effort-optimize.json");

interface ComboResult {
  readonly extractor: string;
  readonly model: string;
  readonly effort: string;
  readonly ok: boolean;
  readonly perfect: boolean;
  readonly runs: number;
  readonly okRuns: number;
  readonly agree: number;
  readonly recall: number;
  readonly prec: number;
  readonly usd: number | null;
  readonly latencyMs: number;
  readonly error?: string;
}

interface Decision {
  readonly extractor: string;
  readonly model: string;
  readonly effort: string;
  readonly usd: number | null;
  readonly agree: number;
  readonly runs: number;
}

interface State {
  tried: ComboResult[];
  winners: Decision[];
}

function loadState(): State {
  if (!existsSync(RESULTS_PATH)) return { tried: [], winners: [] };
  return JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as State;
}

function saveState(state: State): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(state, null, 2) + "\n");
}

function findTried(
  state: State,
  extractor: string,
  model: string,
  effort: string
): ComboResult | undefined {
  return state.tried.find(
    (t) => t.extractor === extractor && t.model === model && t.effort === effort
  );
}

function winnerFor(state: State, extractor: string): Decision | undefined {
  return state.winners.find((w) => w.extractor === extractor);
}

function setWinner(state: State, decision: Decision): void {
  state.winners = [...state.winners.filter((w) => w.extractor !== decision.extractor), decision];
}

function shouldAbandonModel(state: State, extractor: string, model: string): boolean {
  const medium = findTried(state, extractor, model, "medium");
  const high = findTried(state, extractor, model, "high");
  if (!medium || !high) return false;
  if (medium.perfect || high.perfect) return false;
  const gain = high.agree - medium.agree;
  return medium.agree < 0.98 && high.agree < 0.98 && gain < 0.02;
}

async function runCombo(
  extractor: string,
  model: string,
  effort: string
): Promise<ComboResult> {
  const args = [
    "src/sec.ts",
    "eval",
    "s1",
    "--reference",
    "golden",
    "--models",
    model,
    "--extractors",
    extractor,
    "--effort",
    effort,
    "--format",
    "json",
    "--no-details",
  ];
  const proc = Bun.spawn(["bun", ...args], {
    cwd: join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    return {
      extractor,
      model,
      effort,
      ok: false,
      perfect: false,
      runs: 0,
      okRuns: 0,
      agree: 0,
      recall: 0,
      prec: 0,
      usd: null,
      latencyMs: 0,
      error: stderr.slice(-2000) || `exit ${exitCode}`,
    };
  }
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    return {
      extractor,
      model,
      effort,
      ok: false,
      perfect: false,
      runs: 0,
      okRuns: 0,
      agree: 0,
      recall: 0,
      prec: 0,
      usd: null,
      latencyMs: 0,
      error: `no JSON in stdout: ${stdout.slice(0, 500)}`,
    };
  }
  const report = JSON.parse(stdout.slice(jsonStart)) as {
    summaries: Array<{
      model: string;
      runs: number;
      okRuns: number;
      avgAgreement: number;
      avgEntityRecall: number;
      avgPrecision: number;
      avgLatencyMs: number;
      totalUsd: number | null;
    }>;
  };
  const summary = report.summaries.find((s) => s.model === model) ?? report.summaries[0];
  if (!summary) {
    return {
      extractor,
      model,
      effort,
      ok: false,
      perfect: false,
      runs: 0,
      okRuns: 0,
      agree: 0,
      recall: 0,
      prec: 0,
      usd: null,
      latencyMs: 0,
      error: "empty summaries",
    };
  }
  const perfect =
    summary.runs > 0 &&
    summary.okRuns === summary.runs &&
    summary.avgAgreement >= 0.999999 &&
    summary.avgEntityRecall >= 0.999999 &&
    summary.avgPrecision >= 0.999999;
  return {
    extractor,
    model,
    effort,
    ok: summary.okRuns === summary.runs,
    perfect,
    runs: summary.runs,
    okRuns: summary.okRuns,
    agree: summary.avgAgreement,
    recall: summary.avgEntityRecall,
    prec: summary.avgPrecision,
    usd: summary.totalUsd,
    latencyMs: summary.avgLatencyMs,
  };
}

async function ensureCombo(
  state: State,
  extractor: string,
  model: string,
  effort: string
): Promise<ComboResult> {
  const existing = findTried(state, extractor, model, effort);
  if (existing) return existing;
  console.error(`\n>>> ${extractor} | ${model} | effort=${effort}`);
  const result = await runCombo(extractor, model, effort);
  state.tried = [...state.tried, result];
  saveState(state);
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.error(
    `    ok ${result.okRuns}/${result.runs} agree ${pct(result.agree)} ` +
      `recall ${pct(result.recall)} prec ${pct(result.prec)} ` +
      `usd=${result.usd ?? "?"} ${result.latencyMs.toFixed(0)}ms` +
      (result.perfect ? " PERFECT" : "") +
      (result.error ? ` ERR ${result.error.slice(0, 200)}` : "")
  );
  return result;
}

function parseArgs(argv: string[]): { extractors: string[]; resume: boolean } {
  let resume = false;
  let extractors = extractorsWithGoldenLabels().filter((e) => e !== "risk-factors");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--resume") resume = true;
    else if (a === "--extractors") {
      extractors = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  extractors.sort((a, b) => {
    const order = [
      "spac-sponsors",
      "spac-profile",
      "related-party",
      "beneficial-ownership",
      "executive-compensation",
      "management",
      "offering-terms",
      "sponsor-promote",
      "underwriters",
      "spac-classification",
      "use-of-proceeds",
    ];
    return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) -
      (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
  });
  return { extractors, resume };
}

async function searchExtractor(state: State, extractor: string): Promise<void> {
  for (const model of MODELS) {
    if (shouldAbandonModel(state, extractor, model)) {
      console.error(`abandon ${model} for ${extractor}: medium/high plateau under 98%`);
      continue;
    }
    let perfect: ComboResult | undefined;
    for (const effort of ESCALATE) {
      if (shouldAbandonModel(state, extractor, model)) {
        console.error(`abandon ${model} for ${extractor}: medium/high plateau under 98%`);
        break;
      }
      const result = await ensureCombo(state, extractor, model, effort);
      if (result.perfect) {
        perfect = result;
        break;
      }
    }
    if (!perfect) continue;

    let best = perfect;
    for (const effort of DIAL_DOWN) {
      const result = await ensureCombo(state, extractor, model, effort);
      if (result.perfect) best = result;
      else break;
    }
    setWinner(state, {
      extractor,
      model,
      effort: best.effort,
      usd: best.usd,
      agree: best.agree,
      runs: best.runs,
    });
    saveState(state);
    console.error(`WINNER ${extractor}: ${model} @ ${best.effort}`);
    return;
  }
  console.error(`!!! no 100% combo found for ${extractor}`);
}

async function main(): Promise<void> {
  const { extractors, resume } = parseArgs(process.argv.slice(2));
  const state = resume ? loadState() : { tried: [] as ComboResult[], winners: [] as Decision[] };
  if (!resume) saveState(state);

  console.error(`optimize: ${extractors.length} extractor(s); results → ${RESULTS_PATH}`);

  for (const extractor of extractors) {
    if (resume && winnerFor(state, extractor)) {
      const w = winnerFor(state, extractor)!;
      console.error(`skip ${extractor}: already won with ${w.model} @ ${w.effort}`);
      continue;
    }
    await searchExtractor(state, extractor);
  }

  console.error("\n=== winners ===");
  console.log(JSON.stringify(state.winners, null, 2));
}

await main();
