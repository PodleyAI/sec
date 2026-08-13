/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import {
  PROSPECTUS_SUMMARY_TRIM_MAX_CHARS,
  trimProspectusSummarySectionText,
} from "./trimProspectusSummarySection";
import {
  OFFERING_TERMS_TRIM_MAX_CHARS,
  trimOfferingSectionText,
  trimOfferingTermsSectionText,
} from "./trimOfferingSection";
import { trimUnderwritingSectionText } from "./trimUnderwritingSection";
import { trimRelatedPartySectionText } from "./trimRelatedPartySection";
import { trimUseOfProceedsSectionText } from "./trimUseOfProceedsSection";
import { trimBeneficialOwnershipSectionText } from "./trimBeneficialOwnershipSection";
import { trimSpacSponsorsSectionText } from "./trimSpacSponsorsSection";
import { trimLoiSectionText } from "./trimLoiSection";
import { trimSponsorPromoteSectionText } from "./trimSponsorPromoteSection";

describe("trimProspectusSummarySectionText", () => {
  it("cuts at Summary of Risk Factors", () => {
    const input = [
      "We are a blank check company formed for an initial business combination.",
      "",
      "Summary of Risk Factors",
      "",
      "An investment involves risk.",
    ].join("\n");
    const out = trimProspectusSummarySectionText(input);
    expect(out).toContain("blank check");
    expect(out).not.toContain("An investment involves risk");
  });

  it("caps segmenter-collapsed megasections", () => {
    const input = "We are a blank check company.\n\n" + "x".repeat(PROSPECTUS_SUMMARY_TRIM_MAX_CHARS + 20_000);
    const out = trimProspectusSummarySectionText(input);
    expect(out.length).toBeLessThanOrEqual(PROSPECTUS_SUMMARY_TRIM_MAX_CHARS);
    expect(out).toContain("blank check");
  });
});

describe("trimOfferingSectionText", () => {
  it("keeps unit terms; drops later Use of Proceeds", () => {
    const input = [
      "The Offering",
      "",
      "Price per unit: $10.00",
      "Each unit consists of one share and one-half warrant.",
      "",
      "Use of Proceeds",
      "",
      "We will place proceeds in a trust account.",
    ].join("\n");
    // Pad so Use of Proceeds is past the 8% floor
    const padded = "Intro.\n\n" + "y".repeat(2000) + "\n\n" + input;
    const out = trimOfferingSectionText(padded);
    expect(out).toContain("Price per unit");
    expect(out).not.toContain("trust account");
  });
});

describe("trimOfferingTermsSectionText", () => {
  it("caps long offering text for unit/price extraction", () => {
    const input = "Price per unit: $10.00\n" + "x".repeat(OFFERING_TERMS_TRIM_MAX_CHARS + 5_000);
    const out = trimOfferingTermsSectionText(input);
    expect(out.length).toBeLessThanOrEqual(OFFERING_TERMS_TRIM_MAX_CHARS);
    expect(out).toContain("$10.00");
  });
});

describe("trimUnderwritingSectionText", () => {
  it("keeps syndicate terms; drops selling restrictions", () => {
    const input = [
      "Underwriting",
      "",
      "The underwriters are Goldman Sachs and Morgan Stanley.",
      "Underwriting discount: 5.5%.",
      "",
      "Selling Restrictions",
      "",
      "Notice to Prospective Investors in Japan",
      "",
      "This prospectus is not an offer in Japan.",
    ].join("\n");
    const padded = "Lead.\n\n" + "z".repeat(2000) + "\n\n" + input;
    const out = trimUnderwritingSectionText(padded);
    expect(out).toContain("Goldman Sachs");
    expect(out).not.toContain("Japan");
  });
});

describe("trimRelatedPartySectionText", () => {
  it("keeps transactions; drops indemnification", () => {
    const input =
      "We paid $1.0 million to Acme Holdings LLC for shared services.\n\n" +
      "x".repeat(3000) +
      "\n\nIndemnification of Directors and Officers\n\nWe indemnify our directors.";
    const out = trimRelatedPartySectionText(input);
    expect(out).toContain("Acme Holdings");
    expect(out).not.toContain("We indemnify our directors");
  });
});

describe("trimUseOfProceedsSectionText", () => {
  it("keeps proceeds lines; drops dividend policy", () => {
    const input =
      "We intend to use the net proceeds for working capital.\n\n" +
      "y".repeat(2000) +
      "\n\nDividend Policy\n\nWe do not expect to pay dividends.";
    const out = trimUseOfProceedsSectionText(input);
    expect(out).toContain("working capital");
    expect(out).not.toContain("do not expect to pay dividends");
  });

  it("strips bare footnote markers from purpose labels, keeps descriptive parens", () => {
    const input = [
      "Held in trust account(3) | ​ |",
      "Underwriting commissions (0.5% of gross proceeds)(3) | $ | 375,000 |",
      "Nasdaq listing and filing fees (including deferred fees) | $ | 75,000 |",
    ].join("\n");
    const out = trimUseOfProceedsSectionText(input);
    expect(out).toContain("Held in trust account |");
    expect(out).not.toContain("account(3)");
    expect(out).toContain("Underwriting commissions (0.5% of gross proceeds) |");
    expect(out).not.toContain("proceeds)(3)");
    expect(out).toContain("Nasdaq listing and filing fees (including deferred fees) |");
  });
});

describe("trimBeneficialOwnershipSectionText", () => {
  it("keeps ownership table; drops certain relationships", () => {
    const input =
      "| Name | Shares |\n| Jane Roe | 1,000,000 |\n\n" +
      "z".repeat(2000) +
      "\n\nCertain Relationships and Related Transactions\n\nWe lease office space.";
    const out = trimBeneficialOwnershipSectionText(input);
    expect(out).toContain("Jane Roe");
    expect(out).not.toContain("lease office space");
  });
});

describe("trimSpacSponsorsSectionText", () => {
  it("keeps sponsor identity; drops The Offering", () => {
    const input =
      "Our sponsor is Acme Acquisition Holdings LLC.\n\n" +
      "x".repeat(2000) +
      "\n\nThe Offering\n\nPrice per unit is $10.00.";
    const out = trimSpacSponsorsSectionText(input);
    expect(out).toContain("Acme Acquisition Holdings");
    expect(out).not.toContain("Price per unit");
  });
});

describe("trimSponsorPromoteSectionText", () => {
  it("drops private-placement unit counts but keeps warrant counts", () => {
    const input = [
      "Number of private placement warrants to be sold | 48,593 |",
      "Our sponsor has agreed to purchase an aggregate of 194,375 private placement units",
      "(or up to 200,000 private placement units if the overallotment is exercised).",
      "Trust is initially anticipated to be $10.00 per public share.",
    ].join("\n");
    const out = trimSponsorPromoteSectionText(input);
    expect(out).toContain("48,593");
    expect(out).toContain("private placement units");
    expect(out).not.toContain("194,375");
    expect(out).not.toContain("200,000 private placement units");
    expect(out).toContain("$10.00 per public share");
  });
});

describe("trimLoiSectionText", () => {
  it("caps oversized narratives", () => {
    const input = "Letter of intent with Target Co.\n\n" + "w".repeat(120_000);
    const out = trimLoiSectionText(input);
    expect(out.length).toBeLessThanOrEqual(100_000);
    expect(out).toContain("Letter of intent");
  });
});
