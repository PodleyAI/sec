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
import { isUniqueConstraintError } from "../util/isUniqueConstraintError";

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
 * pattern, and the alias-resolution lookup also runs inside the mutex so
 * the queued caller observes both the canonical row and its alias
 * resolution, so concurrent resolves converge to the same final
 * canonical_company_id even when one races an alias rewrite that happens
 * between the create and the alias lookup. The mutex map is
 * instance-scoped: intra-instance contention is serialised via per-key
 * mutexes; multi-instance / multi-process contention is collapsed at the
 * storage layer via UNIQUE constraints on (resolver_version, cik) and
 * (resolver_version, crd_number).
 */
export class CompanyResolver {
  private readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();

  constructor(private opts: CompanyResolverOptions) {}

  async resolve(obs: CompanyObservation): Promise<string> {
    const k = companyKey(obs, this.opts.activeResolverVersion);
    if (k === null) {
      throw new Error(
        `cannot resolve company observation ${obs.observation_id}: no CIK, CRD, or name`
      );
    }
    let entry = this._keyMutexes.get(k.key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      this._keyMutexes.set(k.key, entry);
    }
    entry.refs += 1;

    let resolvedId: string;
    try {
      resolvedId = await entry.mutex.lock(async () => {
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
        let candidateId: string;
        if (candidate) {
          candidateId = candidate.canonical_company_id;
        } else {
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
          try {
            await this.opts.canonicalCompanyRepo.create(fresh);
            candidateId = freshId;
          } catch (err) {
            // A concurrent writer in a different process / resolver
            // instance won the UNIQUE constraint race. Re-query so we
            // converge on the winner's canonical id instead of failing.
            if (!isUniqueConstraintError(err)) throw err;
            let winner: CanonicalCompany | undefined;
            if (k.kind === "cik" && obs.cik !== null && obs.cik !== undefined) {
              winner = await this.opts.canonicalCompanyRepo.findByResolverAndCik(
                this.opts.activeResolverVersion,
                obs.cik
              );
            } else if (k.kind === "crd" && obs.crd_number) {
              winner = await this.opts.canonicalCompanyRepo.findByResolverAndCrd(
                this.opts.activeResolverVersion,
                obs.crd_number
              );
            }
            if (winner === undefined) throw err;
            candidateId = winner.canonical_company_id;
          }
        }
        // Resolve the alias INSIDE the mutex so a concurrent caller that
        // queues behind us cannot observe the freshly-minted candidate
        // before the alias rewrite is applied. Without this, two parallel
        // resolves could split: one returns the alias target, the other
        // returns the pre-alias id.
        return await this.opts.canonicalCompanyAliasRepo.resolve(candidateId);
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0) {
        const current = this._keyMutexes.get(k.key);
        if (current === entry) {
          this._keyMutexes.delete(k.key);
        }
      }
    }

    return resolvedId;
  }
}
