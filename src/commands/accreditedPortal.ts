/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { backfillFormDAttribution } from "../resolver/backfillFormDAttribution";
import { AccreditedPortalRepo } from "../storage/accredited-portal/AccreditedPortalRepo";
import { AccreditedPortalSignalRepo } from "../storage/accredited-portal/AccreditedPortalSignalRepo";
import type { AccreditedPortal } from "../storage/accredited-portal/AccreditedPortalSchema";
import type {
  AccreditedPortalSignal,
  AccreditedPortalSignalType,
} from "../storage/accredited-portal/AccreditedPortalSignalSchema";
import { FormDPortalAttributionRepo } from "../storage/accredited-portal/FormDPortalAttributionRepo";
import { importAccreditedPortals } from "../storage/accredited-portal/importAccreditedPortals";
import {
  normalizeAddressSignal,
  normalizeNameSignal,
  normalizePhoneSignal,
} from "../storage/accredited-portal/SignalNormalization";

function fail(message: string): void {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

async function resolvePortalOrFail(ref: string): Promise<AccreditedPortal | undefined> {
  const portal = await new AccreditedPortalRepo().findPortal(ref);
  if (!portal) {
    fail(`no accredited portal found for '${ref}' — run 'sec accredited-portal import' first?`);
  }
  return portal;
}

interface SignalValueOptions {
  readonly type: string;
  readonly value?: string;
  readonly street1?: string;
  readonly street2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  readonly country?: string;
}

/**
 * Normalizes CLI signal input exactly the way the ingest path normalizes the
 * corresponding filing values, so stored signals match by string equality.
 * Returns null (after reporting) when the value cannot be normalized.
 */
function normalizeSignalInput(
  opts: SignalValueOptions
): { signal_type: AccreditedPortalSignalType; signal_value: string } | null {
  switch (opts.type.toLowerCase()) {
    case "name": {
      if (!opts.value) {
        fail("--value is required for --type name");
        return null;
      }
      const value = normalizeNameSignal(opts.value);
      if (!value) {
        fail(`could not normalize name '${opts.value}' (too short or empty after normalization)`);
        return null;
      }
      return { signal_type: "name", signal_value: value };
    }
    case "phone": {
      if (!opts.value) {
        fail("--value is required for --type phone");
        return null;
      }
      const value = normalizePhoneSignal(opts.value, opts.country);
      if (!value) {
        fail(`could not parse phone number '${opts.value}'`);
        return null;
      }
      return { signal_type: "phone", signal_value: value };
    }
    case "address": {
      // Accept an already-normalized address_hash_id via --value, or address parts.
      if (opts.value) {
        // A normalized hash is the pipe-joined field list; free-form address
        // text stored verbatim would be an inert signal that never matches.
        if (!opts.value.includes("|")) {
          fail(
            "--value for --type address must be a normalized address_hash_id (pipe-joined, as shown by 'signal list'); pass address parts (--street1 --city --state ...) to normalize free-form input"
          );
          return null;
        }
        return { signal_type: "address", signal_value: opts.value.toLowerCase() };
      }
      // No countryCode: the Form D ingest path never has one (issuer addresses
      // carry only stateOrCountry), and normalizeAddress would fall back to it
      // when the state code is unmappable — producing a hash ingest can never
      // produce. Failing loudly instead tells the curator to fix --state.
      const value = normalizeAddressSignal({
        street1: opts.street1 ?? null,
        street2: opts.street2 ?? null,
        city: opts.city ?? null,
        stateOrCountry: opts.state ?? null,
        zipCode: opts.zip ?? null,
      });
      if (!value) {
        fail(
          "could not normalize address — provide at least --street1, --city, and --state with a valid SEC state/country code (or --value with an address_hash_id)"
        );
        return null;
      }
      return { signal_type: "address", signal_value: value };
    }
    default:
      fail(`unknown signal type '${opts.type}' (expected name, phone, or address)`);
      return null;
  }
}

/**
 * The add/remove signal subcommands take the same value inputs; keeping the
 * option set in one place stops the two from drifting apart.
 */
function addSignalValueOptions(cmd: Command): Command {
  return cmd
    .requiredOption("--type <type>", "signal type: name, phone, or address")
    .option("--value <value>", "name/phone text, or a pre-normalized address_hash_id")
    .option("--street1 <street1>", "address street line 1")
    .option("--street2 <street2>", "address street line 2")
    .option("--city <city>", "address city")
    .option("--state <state>", "address state or country code (SEC code)")
    .option("--zip <zip>", "address postal code")
    .option(
      "--country <country>",
      "ISO country code for phone parsing; must match the filings' issuer country or the parsed international number will differ (addresses use --state)",
      "US"
    );
}

function printSignal(signal: AccreditedPortalSignal): void {
  console.log(
    `${signal.portal_id}\t${signal.signal_type}\t${signal.signal_value}\t${signal.source}\t${signal.note ?? ""}`
  );
}

export function registerAccreditedPortalCommands(program: Command): void {
  const group = program
    .command("accredited-portal")
    .description("Accredited-investor portals (AngelList, Forge, ...) and Form D attribution");

  group
    .command("import [file]")
    .description(
      "Bootstrap/refresh portals from the embedded seed (or a JSON file); idempotent, preserves curation"
    )
    .action(async (file: string | undefined) => {
      try {
        const result = await importAccreditedPortals(file);
        console.log(
          `imported ${result.portals} portals; seeded ${result.signalsSeeded} name signals` +
            (result.signalsSkippedManual > 0 ? ` (${result.signalsSkippedManual} kept manual)` : "")
        );
      } catch (e) {
        fail((e as Error).message);
      }
    });

  group
    .command("list")
    .description("List accredited portals")
    .option("--live", "only portals currently operating", false)
    .option("--format <format>", "output format: text or json", "text")
    .action(async (opts: { live: boolean; format: string }) => {
      const repo = new AccreditedPortalRepo();
      const portals = opts.live ? await repo.getLivePortals() : await repo.getAllPortals();
      portals.sort((a, b) => a.portal_id.localeCompare(b.portal_id));
      if (opts.format === "json") {
        console.log(JSON.stringify(portals, null, 2));
        return;
      }
      for (const p of portals) {
        console.log(
          `${p.portal_id}\t${p.name}\t${p.live ? "live" : "closed"}\t${p.url ?? ""}\t${p.brand ?? ""}`
        );
      }
    });

  const signal = new Command("signal").description(
    "Manage portal fingerprints (names, phones, addresses) used for Form D attribution"
  );

  addSignalValueOptions(signal.command("add <portal>"))
    .description("Add a fingerprint for a portal (normalized before storing)")
    .option("--note <note>", "curation note")
    .action(async (portalRef: string, opts: SignalValueOptions & { note?: string }) => {
      const portal = await resolvePortalOrFail(portalRef);
      if (!portal) return;
      const normalized = normalizeSignalInput(opts);
      if (!normalized) return;
      await new AccreditedPortalSignalRepo().saveSignal({
        ...normalized,
        portal_id: portal.portal_id,
        source: "manual",
        note: opts.note ?? null,
        created_at: new Date().toISOString(),
      });
      console.log(
        `added ${normalized.signal_type} signal '${normalized.signal_value}' -> ${portal.portal_id}`
      );
    });

  signal
    .command("list [portal]")
    .description("List signals, optionally for one portal")
    .action(async (portalRef: string | undefined) => {
      const repo = new AccreditedPortalSignalRepo();
      if (portalRef) {
        const portal = await resolvePortalOrFail(portalRef);
        if (!portal) return;
        for (const s of await repo.listByPortal(portal.portal_id)) printSignal(s);
        return;
      }
      const all = await repo.getAllSignals();
      all.sort((a, b) => a.portal_id.localeCompare(b.portal_id));
      for (const s of all) printSignal(s);
    });

  addSignalValueOptions(signal.command("remove"))
    .description("Remove a fingerprint (input is normalized before lookup)")
    .action(async (opts: SignalValueOptions) => {
      const normalized = normalizeSignalInput(opts);
      if (!normalized) return;
      const repo = new AccreditedPortalSignalRepo();
      const existing = await repo.getSignal(normalized.signal_type, normalized.signal_value);
      if (!existing) {
        fail(`no ${normalized.signal_type} signal found for '${normalized.signal_value}'`);
        return;
      }
      await repo.removeSignal(normalized.signal_type, normalized.signal_value);
      console.log(
        `removed ${normalized.signal_type} signal '${normalized.signal_value}' (was -> ${existing.portal_id}); ` +
          `run 'sec accredited-portal attribute --all' to drop stale attributions`
      );
    });

  group.addCommand(signal);

  group
    .command("attribute")
    .description("Recompute Form D portal attributions from stored observations")
    .option("--all", "recompute for all portals (clears the attribution table first)", false)
    .option("--portal <portal>", "recompute only this portal's attributions")
    .action(async (opts: { all: boolean; portal?: string }) => {
      if (!opts.all && !opts.portal) {
        fail("pass --all to recompute everything, or --portal <id> for one portal");
        return;
      }
      let portalId: string | undefined;
      if (opts.portal) {
        const portal = await resolvePortalOrFail(opts.portal);
        if (!portal) return;
        portalId = portal.portal_id;
      }
      const result = await backfillFormDAttribution({ portalId });
      console.log(
        `attributed ${result.attributions} filings across ${result.filings} Form D accessions` +
          (portalId ? ` (portal ${portalId}, cleared ${result.cleared} prior rows)` : "")
      );
    });

  group
    .command("filings <portal>")
    .description("List Form D filings attributed to a portal")
    .option("--format <format>", "output format: text or json", "text")
    .action(async (portalRef: string, opts: { format: string }) => {
      const portal = await resolvePortalOrFail(portalRef);
      if (!portal) return;
      const rows = await new FormDPortalAttributionRepo().listByPortal(portal.portal_id);
      rows.sort((a, b) => (a.filing_date ?? "").localeCompare(b.filing_date ?? ""));
      if (opts.format === "json") {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.filing_date ?? "?"}\t${r.cik ?? "?"}\t${r.accession_number}\t${r.matched_signal_type}=${r.matched_signal_value}`
        );
      }
    });
}
