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
  readonly featured: boolean | null;
}

export const ACCREDITED_PORTALS_SEED: readonly AccreditedPortalSeedEntry[] = [
  {
    name: "AngelList",
    brand: null,
    url: "https://www.angellist.com/",
    live: true,
    featured: true,
  },
  {
    name: "Forge Global",
    brand: null,
    url: "https://forgeglobal.com/",
    live: true,
    featured: true,
  },
  {
    name: "EquityZen",
    brand: null,
    url: "https://equityzen.com/",
    live: true,
    featured: true,
  },
  {
    name: "Hiive",
    brand: null,
    url: "https://www.hiive.com/",
    live: true,
    featured: true,
  },
  {
    name: "OurCrowd",
    brand: null,
    url: "https://www.ourcrowd.com/",
    live: true,
    featured: true,
  },
  {
    name: "Republic",
    brand: null,
    url: "https://republic.com/",
    live: true,
    featured: true,
  },
  {
    name: "Moonfare",
    brand: null,
    url: "https://www.moonfare.com/",
    live: true,
    featured: true,
  },
  {
    name: "Nasdaq Private Market",
    brand: null,
    url: "https://www.nasdaqprivatemarket.com/",
    live: true,
    featured: true,
  },
  {
    name: "CrowdStreet",
    brand: null,
    url: "https://www.crowdstreet.com/",
    live: true,
    featured: true,
  },
  {
    name: "Percent",
    brand: null,
    url: "https://percent.com/",
    live: true,
    featured: true,
  },
  {
    name: "Gaingels",
    brand: null,
    url: "https://gaingels.com/",
    live: true,
    featured: null,
  },
  {
    name: "MicroVentures",
    brand: null,
    url: "https://microventures.com/",
    live: true,
    featured: null,
  },
  {
    name: "Allocations",
    brand: null,
    url: "https://www.allocations.com/",
    live: true,
    featured: null,
  },
  {
    name: "Sydecar",
    brand: null,
    url: "https://sydecar.io/",
    live: true,
    featured: null,
  },
  {
    name: "EquityBee",
    brand: null,
    url: "https://www.equitybee.com/",
    live: true,
    featured: null,
  },
  {
    name: "Rainmaker Securities",
    brand: null,
    url: "https://rainmakersecurities.com/",
    live: true,
    featured: null,
  },
  {
    name: "UpMarket",
    brand: null,
    url: "https://www.upmarket.co/",
    live: true,
    featured: null,
  },
  {
    name: "Zanbato",
    brand: null,
    url: "https://www.zanbato.com/",
    live: true,
    featured: null,
  },
  {
    name: "iCapital",
    brand: null,
    url: "https://icapital.com/",
    live: true,
    featured: null,
  },
  {
    name: "CAIS",
    brand: null,
    url: "https://www.caisgroup.com/",
    live: true,
    featured: null,
  },
  {
    name: "Arta Finance",
    brand: null,
    url: "https://artafinance.com/",
    live: true,
    featured: null,
  },
  {
    name: "Willow Wealth",
    brand: "Yieldstreet",
    url: "https://www.willowwealth.com/",
    live: true,
    featured: null,
  },
  {
    name: "Fundrise",
    brand: null,
    url: "https://fundrise.com/",
    live: true,
    featured: null,
  },
  {
    name: "RealtyMogul",
    brand: null,
    url: "https://www.realtymogul.com/",
    live: true,
    featured: null,
  },
  {
    name: "EquityMultiple",
    brand: null,
    url: "https://www.equitymultiple.com/",
    live: true,
    featured: null,
  },
  {
    name: "AcreTrader",
    brand: null,
    url: "https://acretrader.com/",
    live: true,
    featured: null,
  },
  {
    name: "FarmTogether",
    brand: null,
    url: "https://farmtogether.com/",
    live: true,
    featured: null,
  },
  {
    name: "SeedInvest",
    brand: "now part of StartEngine",
    url: "https://www.startengine.com/seedinvest",
    live: false,
    featured: null,
  },
  {
    name: "Linqto",
    brand: null,
    url: "https://www.linqto.com/",
    live: false,
    featured: null,
  },
  {
    name: "PeerStreet",
    brand: null,
    url: "https://www.peerstreet.com/",
    live: false,
    featured: null,
  },
  {
    name: "AltoIRA",
    brand: null,
    url: "https://www.altoira.com/",
    live: true,
    featured: null,
  },
] as const;
