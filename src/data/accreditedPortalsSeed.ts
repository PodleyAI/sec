/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Curated accredited-investor portal seed, derived from the embarc repo's
 * data/portals-accredited.json. Embedded as TypeScript so the bundled CLI
 * carries it; refresh by re-deriving from the embarc file and re-running
 * `sec accredited-portal import`.
 */

export interface AccreditedPortalSeedEntry {
  readonly name: string;
  readonly brand: string | null;
  readonly url: string | null;
  readonly live: boolean | null;
}

export const ACCREDITED_PORTALS_SEED: readonly AccreditedPortalSeedEntry[] = [
  {
    name: "AngelList",
    brand: null,
    url: "https://www.angellist.com/",
    live: true,
  },
  {
    name: "Forge Global",
    brand: null,
    url: "https://forgeglobal.com/",
    live: true,
  },
  {
    name: "EquityZen",
    brand: null,
    url: "https://equityzen.com/",
    live: true,
  },
  {
    name: "Hiive",
    brand: null,
    url: "https://www.hiive.com/",
    live: true,
  },
  {
    name: "OurCrowd",
    brand: null,
    url: "https://www.ourcrowd.com/",
    live: true,
  },
  {
    name: "Republic",
    brand: null,
    url: "https://republic.com/",
    live: true,
  },
  {
    name: "Moonfare",
    brand: null,
    url: "https://www.moonfare.com/",
    live: true,
  },
  {
    name: "Nasdaq Private Market",
    brand: null,
    url: "https://www.nasdaqprivatemarket.com/",
    live: true,
  },
  {
    name: "CrowdStreet",
    brand: null,
    url: "https://www.crowdstreet.com/",
    live: true,
  },
  {
    name: "Percent",
    brand: null,
    url: "https://percent.com/",
    live: true,
  },
  {
    name: "Gaingels",
    brand: null,
    url: "https://gaingels.com/",
    live: true,
  },
  {
    name: "MicroVentures",
    brand: null,
    url: "https://microventures.com/",
    live: true,
  },
  {
    name: "Allocations",
    brand: null,
    url: "https://www.allocations.com/",
    live: true,
  },
  {
    name: "Sydecar",
    brand: null,
    url: "https://sydecar.io/",
    live: true,
  },
  {
    name: "EquityBee",
    brand: null,
    url: "https://www.equitybee.com/",
    live: true,
  },
  {
    name: "Rainmaker Securities",
    brand: null,
    url: "https://rainmakersecurities.com/",
    live: true,
  },
  {
    name: "UpMarket",
    brand: null,
    url: "https://www.upmarket.co/",
    live: true,
  },
  {
    name: "Zanbato",
    brand: null,
    url: "https://www.zanbato.com/",
    live: true,
  },
  {
    name: "iCapital",
    brand: null,
    url: "https://icapital.com/",
    live: true,
  },
  {
    name: "CAIS",
    brand: null,
    url: "https://www.caisgroup.com/",
    live: true,
  },
  {
    name: "Arta Finance",
    brand: null,
    url: "https://artafinance.com/",
    live: true,
  },
  {
    name: "Willow Wealth",
    brand: "Yieldstreet",
    url: "https://www.willowwealth.com/",
    live: true,
  },
  {
    name: "Fundrise",
    brand: null,
    url: "https://fundrise.com/",
    live: true,
  },
  {
    name: "RealtyMogul",
    brand: null,
    url: "https://www.realtymogul.com/",
    live: true,
  },
  {
    name: "EquityMultiple",
    brand: null,
    url: "https://www.equitymultiple.com/",
    live: true,
  },
  {
    name: "AcreTrader",
    brand: null,
    url: "https://acretrader.com/",
    live: true,
  },
  {
    name: "FarmTogether",
    brand: null,
    url: "https://farmtogether.com/",
    live: true,
  },
  {
    name: "SeedInvest",
    brand: "now part of StartEngine",
    url: "https://www.startengine.com/seedinvest",
    live: false,
  },
  {
    name: "Linqto",
    brand: null,
    url: "https://www.linqto.com/",
    live: false,
  },
  {
    name: "PeerStreet",
    brand: null,
    url: "https://www.peerstreet.com/",
    live: false,
  },
  {
    name: "AltoIRA",
    brand: null,
    url: "https://www.altoira.com/",
    live: true,
  },
] as const;
