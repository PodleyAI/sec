/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, expect, test } from "bun:test";
import {
  registerResolverExtension,
  getResolverExtension,
  listResolverIds,
  isFamilyResolverId,
  clearResolverExtensionsForTesting,
} from "./resolverExtensions";

afterEach(() => clearResolverExtensionsForTesting());

test("register + lookup by id", () => {
  registerResolverExtension({ id: "demo" });
  expect(getResolverExtension("demo")?.id).toBe("demo");
  expect(listResolverIds()).toContain("demo");
});

test("re-registering the same id overwrites, no duplicate", () => {
  registerResolverExtension({ id: "demo" });
  registerResolverExtension({ id: "demo", isFamily: true });
  expect(listResolverIds().filter((k) => k === "demo")).toHaveLength(1);
  expect(isFamilyResolverId("demo")).toBe(true);
});

test("isFamilyResolverId false for unknown / non-family", () => {
  registerResolverExtension({ id: "plain" });
  expect(isFamilyResolverId("plain")).toBe(false);
  expect(isFamilyResolverId("nope")).toBe(false);
});

test("coverage/dropPrevious are the registered closures", async () => {
  let dropped = "";
  registerResolverExtension({
    id: "cov",
    coverage: async (v) => ({ numerator: 1, denominator: v === "1.0.0" ? 2 : 0 }),
    dropPrevious: async (v) => { dropped = v; },
  });
  expect(await getResolverExtension("cov")!.coverage!("1.0.0")).toEqual({ numerator: 1, denominator: 2 });
  await getResolverExtension("cov")!.dropPrevious!("0.9.0");
  expect(dropped).toBe("0.9.0");
});
