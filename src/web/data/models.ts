/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { defaultModelIds, modelIdsFromEnv } from "../../config/Constants";
import { listPricingForModelId } from "../../config/listPricing";
import { modelApiKeyEnvVar, trySecModelRecord } from "../../config/registerModels";

/**
 * One knob the pipeline reads a model id from.
 *
 * The pipeline resolves its model per extractor through `modelIdsFromEnv` at
 * CALL time, so a web run selects a model by setting the same environment
 * variable around the run rather than by threading a parameter through every
 * extractor. That is why the slots are enumerated here rather than inferred:
 * the set of variables IS the contract, and a slot missing from this list is a
 * model choice the UI silently cannot make.
 */
export interface ModelSlot {
  readonly id: string;
  readonly envVar: string;
  readonly label: string;
  readonly description: string;
}

export const MODEL_SLOTS: readonly ModelSlot[] = [
  {
    id: "default",
    envVar: "SEC_MODEL_DEFAULT",
    label: "All extractors",
    description: "Shared default every extractor falls back to when its own slot is unset.",
  },
  {
    id: "s1",
    envVar: "SEC_S1_MODEL",
    label: "S-1 / 424 sections",
    description:
      "Management, beneficial ownership, related party, offering terms, underwriters, use of proceeds, sponsors, promote.",
  },
  {
    id: "s1-classifier",
    envVar: "SEC_S1_CLASSIFIER_MODEL",
    label: "SPAC content classifier",
    description: "Decides whether a registration statement is really a blank check.",
  },
  {
    id: "risk-factors",
    envVar: "SEC_S1_RISK_FACTORS_MODEL",
    label: "Risk factors",
    description: "The chunked Item 105 list — by far the most expensive section per filing.",
  },
  {
    id: "merger-proxy",
    envVar: "SEC_MERGER_PROXY_MODEL",
    label: "Merger proxies",
    description: "Target, PIPE amount and consideration from DEFM14A / PREM14A.",
  },
  {
    id: "redemption",
    envVar: "SEC_REDEMPTION_MODEL",
    label: "Redemption 8-Ks",
    description: "Realized redemption amounts and share counts from post-vote narratives.",
  },
  {
    id: "loi",
    envVar: "SEC_LOI_MODEL",
    label: "Letter-of-intent 8-Ks",
    description: "Non-binding LOI / agreement-in-principle detection.",
  },
];

/** A model id the UI offers, with everything needed to say whether it can run here. */
export interface ModelOption {
  readonly id: string;
  readonly provider: string;
  /** The API key variable this id's provider needs, or "" for a local / deterministic one. */
  readonly apiKeyEnvVar: string;
  /** False when {@link apiKeyEnvVar} is named but unset — the run would dead-letter. */
  readonly available: boolean;
  /** Input $/1M as list price, or null when the id has no published pricing. */
  readonly inputPricePerM: number | null;
}

/**
 * Ids offered in the picker by default.
 *
 * Deliberately a suggestion list, not an allow-list: the picker also takes a
 * free-text id, and `registerModelIds` mints a record for any shape
 * `secModelRecord` recognizes. Pinning the offered set would make the UI the
 * one place in sec where a newly released model cannot be tried.
 */
export const SUGGESTED_MODEL_IDS: readonly string[] = [
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gpt-5.5",
  "gpt-5.4-mini",
  "gemini-3.1-pro-preview",
  "gemini-3.6-flash",
  "grok-4.5",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deterministic",
];

/** Describe one model id: provider, key requirement, and whether it can run here. */
export function describeModel(id: string): ModelOption {
  const record = trySecModelRecord(id);
  const keyVar = modelApiKeyEnvVar(id) ?? "";
  const pricing = listPricingForModelId(id);
  return {
    id,
    provider: record?.provider ?? "",
    apiKeyEnvVar: keyVar,
    available: keyVar === "" ? true : (process.env[keyVar] ?? "") !== "",
    inputPricePerM: pricing?.input ?? null,
  };
}

/**
 * The suggested ids plus everything the environment already configures, so the
 * picker always contains the model a run would use if nothing were chosen.
 */
export function modelOptions(): readonly ModelOption[] {
  const ids = new Set<string>(SUGGESTED_MODEL_IDS);
  for (const slot of MODEL_SLOTS) {
    for (const id of modelIdsFromEnv(process.env[slot.envVar])) ids.add(id);
  }
  return [...ids].map(describeModel);
}

/** What each slot resolves to right now, for display next to the picker. */
export function currentSlotModels(): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const slot of MODEL_SLOTS) {
    out.set(
      slot.id,
      slot.id === "default" ? defaultModelIds() : modelIdsFromEnv(process.env[slot.envVar])
    );
  }
  return out;
}

/** A caller-chosen model per slot id. An absent or empty entry leaves the slot alone. */
export type ModelOverrides = Readonly<Record<string, string | undefined>>;

/** Slot ids the UI may set, so an unknown key cannot set an arbitrary env var. */
const SLOT_BY_ID: ReadonlyMap<string, ModelSlot> = new Map(MODEL_SLOTS.map((s) => [s.id, s]));

/**
 * Run `fn` with the requested model slots set, restoring the previous
 * environment afterwards.
 *
 * Mutating `process.env` is the only seam the extractors expose — they read
 * their model through `modelIdsFromEnv` at call time and take no parameter —
 * so a run that names a model has to set it globally for the duration. That
 * makes it process-wide state, which is why every model-bearing run in the web
 * server is serialized through one queue: two concurrent runs with different
 * models would each observe the other's.
 *
 * Restoration deletes a variable that was previously absent rather than setting
 * it to "", because `modelIdsFromEnv` treats an empty string as "unset" but
 * `secModelIds()` (which registers models at startup) reads the raw value, and
 * leaving `SEC_S1_MODEL=""` behind is a difference an operator would have no
 * way to see.
 */
export async function withModelOverrides<T>(
  overrides: ModelOverrides,
  fn: () => Promise<T>
): Promise<T> {
  const previous: { readonly name: string; readonly value: string | undefined }[] = [];
  for (const [slotId, value] of Object.entries(overrides)) {
    const slot = SLOT_BY_ID.get(slotId);
    if (slot === undefined) continue;
    const trimmed = (value ?? "").trim();
    if (trimmed === "") continue;
    previous.push({ name: slot.envVar, value: process.env[slot.envVar] });
    process.env[slot.envVar] = trimmed;
  }
  try {
    return await fn();
  } finally {
    for (const entry of previous) {
      if (entry.value === undefined) delete process.env[entry.name];
      else process.env[entry.name] = entry.value;
    }
  }
}

/** The slots a set of overrides actually changes, for the run log's header line. */
export function describeOverrides(overrides: ModelOverrides): readonly string[] {
  const out: string[] = [];
  for (const slot of MODEL_SLOTS) {
    const value = (overrides[slot.id] ?? "").trim();
    if (value !== "") out.push(`${slot.envVar}=${value}`);
  }
  return out;
}
