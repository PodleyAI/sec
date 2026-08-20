/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { seeksCombinationApproval } from "./seeksCombinationApproval";

describe("seeksCombinationApproval", () => {
  describe("approval-shaped statements", () => {
    it("recognizes the numbered defined-term proposal heading", () => {
      expect(seeksCombinationApproval("Proposal No. 1 — The Business Combination Proposal")).toBe(
        true
      );
    });

    it("recognizes a request to approve and adopt the merger agreement", () => {
      expect(
        seeksCombinationApproval(
          "To approve and adopt the Agreement and Plan of Merger, dated as of March 1, 2021, " +
            "by and among the Company, Merger Sub and Acme Target Inc."
        )
      ).toBe(true);
    });

    it("recognizes the plain defined term in a notice of meeting", () => {
      // A notice enumerates its items; the second is the combination.
      const notice = [
        "NOTICE OF SPECIAL MEETING OF STOCKHOLDERS",
        "1. Proposal No. 1 — The Domestication Proposal",
        "2. Proposal No. 2 — the Business Combination Proposal",
        "3. Proposal No. 3 — The Adjournment Proposal",
      ].join("\n");
      expect(seeksCombinationApproval(notice)).toBe(true);
    });

    it("recognizes the table-of-contents row real filers render", () => {
      // The markdown renderer emits TOC rows as pipe-delimited table cells, and
      // filers interpolate their own name into the defined term.
      expect(
        seeksCombinationApproval(
          "| PROPOSAL NO. 1—THE PENSARE BUSINESS COMBINATION PROPOSAL | 115 |"
        )
      ).toBe(true);
      expect(
        seeksCombinationApproval(
          "| SPAC SHAREHOLDER PROPOSAL NO. 1 — THE BUSINESS COMBINATION PROPOSAL | | 101 |"
        )
      ).toBe(true);
    });

    it("still fires when an extension proposal sits beside the combination proposal", () => {
      // A combined extension-plus-combination meeting IS a merger proxy.
      const both = [
        "Proposal No. 1 — The Extension Amendment Proposal",
        "Proposal No. 2 — The Business Combination Proposal",
      ].join("\n");
      expect(seeksCombinationApproval(both)).toBe(true);
    });
  });

  describe("statements that decide something else", () => {
    it("rejects the standard extension wording", () => {
      // The approval object is the charter amendment, not the agreement. This
      // is the exact sentence that made an extension vote read as a merger
      // proxy, so it must never match.
      expect(
        seeksCombinationApproval(
          "To approve an amendment to the Company's amended and restated certificate of " +
            "incorporation to extend the date by which the Company must consummate a business combination"
        )
      ).toBe(false);
    });

    it("rejects an annual-meeting proposal list", () => {
      const annual = [
        "NOTICE OF ANNUAL MEETING OF STOCKHOLDERS",
        "Proposal No. 1 — To elect two Class I directors to serve until the 2027 annual meeting.",
        "Proposal No. 2 — To ratify the appointment of the independent registered public accounting firm.",
        "Proposal No. 3 — To approve, on an advisory basis, the compensation of our named executive officers.",
      ].join("\n");
      expect(seeksCombinationApproval(annual)).toBe(false);
    });

    it("rejects a background paragraph reciting a pending combination", () => {
      // An extension proxy describes the announced deal at length; the merger
      // section extractor is satisfied by exactly this prose, which is why the
      // event needs approval evidence on top of an extracted deal.
      const background =
        "On March 1, 2021, the Company entered into a business combination agreement with " +
        "Acme Target Inc., a leading operating company in its sector. Upon the closing of the " +
        "business combination with Acme Target Inc., the post-combination company will continue " +
        "the business of Acme Target Inc. The Company is seeking additional time to complete the " +
        "business combination.";
      expect(seeksCombinationApproval(background)).toBe(false);
    });

    it("rejects the trust-redemption boilerplate every extension proxy carries", () => {
      // "voted against a business combination proposal" is a generic reference,
      // not this meeting's ballot item — it fired on 24 of the 348 measured
      // filings, every one of them an extension or annual meeting.
      expect(
        seeksCombinationApproval(
          "Public stockholders may elect to convert their shares into a pro rata portion of the " +
            "funds available in the trust account, calculated as if they had voted against a " +
            "business combination proposal."
        )
      ).toBe(false);
    });

    it("rejects a cross-reference to a proposal in another filing", () => {
      expect(
        seeksCombinationApproval(
          "For more information about the HighPeak Business Combination, see the section entitled " +
            "“Proposal No. 1—The Business Combination Proposal” located in the Registration Statement."
        )
      ).toBe(false);
    });

    it("rejects empty input", () => {
      expect(seeksCombinationApproval("")).toBe(false);
    });
  });
});
