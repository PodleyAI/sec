/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "bun:test";
import { isSpac, selectS1Sample, SPAC_SIC_CODE } from "./fetchS1Fixtures";
import type { S1Candidate } from "./fetchS1Fixtures";

const cand = (n: number, o: Partial<S1Candidate> = {}): S1Candidate => ({
  cik: String(1000 + n),
  accession: `000-${n}`,
  companyName: `Co ${n}`,
  sicCode: undefined,
  primaryDoc: `doc${n}.htm`,
  ...o,
});

describe("selectS1Sample", () => {
  it("meets the SPAC floor even when SPACs are sparse / late in the list", () => {
    const candidates: S1Candidate[] = [
      cand(1),
      cand(2),
      cand(3),
      cand(4),
      cand(5, { sicCode: SPAC_SIC_CODE }),
      cand(6, { sicCode: SPAC_SIC_CODE }),
      cand(7, { sicCode: SPAC_SIC_CODE }),
    ];
    const picked = selectS1Sample(candidates, 4, 3);
    expect(picked).toHaveLength(4);
    expect(picked.filter(isSpac).length).toBeGreaterThanOrEqual(3);
  });

  it("excludes candidates without a primary doc", () => {
    const picked = selectS1Sample(
      [cand(1, { primaryDoc: undefined }), cand(2), cand(3)],
      5,
      0
    );
    expect(picked.map((c) => c.accession)).toEqual(["000-2", "000-3"]);
  });

  it("dedupes by accession", () => {
    const picked = selectS1Sample([cand(1), cand(1), cand(2)], 5, 0);
    expect(picked).toHaveLength(2);
  });

  it("caps at count", () => {
    const many = Array.from({ length: 20 }, (_, i) => cand(i));
    expect(selectS1Sample(many, 7, 0)).toHaveLength(7);
  });

  it("rejects minSpac greater than count", () => {
    expect(() => selectS1Sample([cand(1)], 2, 3)).toThrow();
  });
});
