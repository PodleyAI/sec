/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import type { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import type { CanonicalCompany } from "../storage/canonical/CanonicalCompanySchema";
import { AsyncMutex } from "../util/AsyncMutex";

interface CompanyResolverOptions {
  canonicalCompanyRepo: CanonicalCompanyRepo;
  canonicalCompanyAliasRepo: CanonicalCompanyAliasRepo;
  activeResolverVersion: string;
}

type CompanyKeyKind = "cik" | "crd" | "name";

function companyKey(
  obs: CompanyObservation,
  resolverVersion: string
): { key: string; kind: CompanyKeyKind } | null {
  if (obs.cik !== null && obs.cik !== undefined) {
    return { key: `${resolverVersion}|cik|${obs.cik}`, kind: "cik" };
  }
  if (obs.crd_number) {
    return { key: `${resolverVersion}|crd|${obs.crd_number}`, kind: "crd" };
  }
  if (obs.normalized_name) {
    return { key: `${resolverVersion}|name|${obs.normalized_name}`, kind: "name" };
  }
  return null;
}

/**
 * Matches a CompanyObservation to an existing canonical company or creates one.
 * Resolution cascade: CIK → CRD number → normalized name. Throws if none is available.
 * Delegates alias indirection to CanonicalCompanyAliasRepo.
 *
 * Concurrency: see PersonResolver — same per-key AsyncMutex with refcount
 * pattern. Multi-process callers still need a backend UNIQUE constraint.
 */
export class CompanyResolver {
  private static readonly _keyMutexes = new Map<
    string,
    { mutex: AsyncMutex; refs: number }
  >();

  constructor(private opts: CompanyResolverOptions) {}

  async resolve(obs: CompanyObservation): Promise<string> {
    const k = companyKey(obs, this.opts.activeResolverVersion);
    if (k === null) {
      throw new Error(
        `cannot resolve company observation ${obs.observation_id}: no CIK, CRD, or name`
      );
    }
    let entry = CompanyResolver._keyMutexes.get(k.key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      CompanyResolver._keyMutexes.set(k.key, entry);
    }
    entry.refs += 1;

    let candidateId: string;
    try {
      candidateId = await entry.mutex.lock(async () => {
        // Re-query inside the critical section — a queued caller might
        // have just created the row we're about to mint.
        let candidate: CanonicalCompany | undefined;
        if (k.kind === "cik" && obs.cik !== null && obs.cik !== undefined) {
          candidate = await this.opts.canonicalCompanyRepo.findByResolverAndCik(
            this.opts.activeResolverVersion,
            obs.cik
          );
        } else if (k.kind === "crd" && obs.crd_number) {
          candidate = await this.opts.canonicalCompanyRepo.findByResolverAndCrd(
            this.opts.activeResolverVersion,
            obs.crd_number
          );
        } else if (k.kind === "name" && obs.normalized_name) {
          candidate = await this.opts.canonicalCompanyRepo.findByResolverAndName(
            this.opts.activeResolverVersion,
            obs.normalized_name
          );
        }
        if (candidate) {
          return candidate.canonical_company_id;
        }
        const freshId = randomUUID();
        const fresh: CanonicalCompany = {
          canonical_company_id: freshId,
          resolver_version: this.opts.activeResolverVersion,
          display_name: obs.name,
          cik: obs.cik ?? null,
          crd_number: obs.crd_number ?? null,
          normalized_name: obs.normalized_name ?? null,
          created_at: new Date().toISOString(),
        };
        await this.opts.canonicalCompanyRepo.create(fresh);
        return freshId;
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0) {
        const current = CompanyResolver._keyMutexes.get(k.key);
        if (current === entry) {
          CompanyResolver._keyMutexes.delete(k.key);
        }
      }
    }

    return await this.opts.canonicalCompanyAliasRepo.resolve(candidateId);
  }
}
