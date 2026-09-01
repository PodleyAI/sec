import {
  buildCommandTree,
  findCommandNode,
  matchPathSpecificity,
  resolveCommandAnnotation,
  resolveCommandFields,
  type WebCommandNode,
} from "@workglow/cli";
import { Command } from "commander";
import { beforeAll, describe, expect, it } from "vitest";
import { AddCommands } from "../commands";
import { SEC_COMMAND_ANNOTATION_PATHS, SEC_FIELD_ANNOTATION_PATHS } from "./secAnnotations";

/**
 * The failure this file exists to catch is silence.
 *
 * An annotation is matched by path, so a renamed command or a mistyped segment
 * does not error — the picker simply never appears, the badge never renders,
 * and the console looks exactly as it did before anyone did this work. Nothing
 * else in the system notices, which is why the paths are asserted against the
 * real program tree.
 */

let tree: readonly WebCommandNode[];

beforeAll(() => {
  const program = new Command();
  program.name("sec");
  // `AddCommands` registers commands and the console's UI; it installs a
  // preAction hook but runs no runtime, so building the tree touches nothing.
  AddCommands(program);
  tree = buildCommandTree(program);
});

/** Every command path in the program, flattened. */
function allPaths(nodes: readonly WebCommandNode[]): readonly (readonly string[])[] {
  return nodes.flatMap((node) => [node.path, ...allPaths(node.children)]);
}

describe("annotation paths name real commands", () => {
  it.each([...SEC_FIELD_ANNOTATION_PATHS])("field annotation %s matches a command", (path) => {
    const pattern = path.split(" ");
    // The catch-all is intentionally universal; every other pattern must reach
    // at least one command that exists.
    if (pattern.length === 1 && pattern[0] === "**") return;
    const matched = allPaths(tree).filter(
      (candidate) => matchPathSpecificity(pattern, candidate) >= 0
    );
    expect(matched.length, `no command matches "${path}"`).toBeGreaterThan(0);
  });

  it.each([...SEC_COMMAND_ANNOTATION_PATHS])("command annotation %s matches a command", (path) => {
    const pattern = path.split(" ");
    const matched = allPaths(tree).filter(
      (candidate) => matchPathSpecificity(pattern, candidate) >= 0
    );
    expect(matched.length, `no command matches "${path}"`).toBeGreaterThan(0);
  });
});

describe("annotated fields reach the form", () => {
  it("gives every CIK positional the search picker", async () => {
    for (const path of [
      ["query", "facts"],
      ["query", "entities"],
    ]) {
      const node = findCommandNode(tree, path);
      expect(node, path.join(" ")).toBeDefined();
      const fields = await resolveCommandFields(node!, []);
      const cik = fields.find((field) => field.key === "cik");
      expect(cik?.format, `${path.join(" ")} cik`).toMatch(/^sec:/);
    }
  });

  it("gives each command the format vocabulary its own help text states", async () => {
    const cases: readonly [readonly string[], readonly string[]][] = [
      [
        ["query", "entities"],
        ["table", "json", "csv"],
      ],
      [
        ["query", "filings"],
        ["table", "json", "csv"],
      ],
      [
        ["version", "status"],
        ["table", "json"],
      ],
    ];
    for (const [path, choices] of cases) {
      const node = findCommandNode(tree, path);
      expect(node, path.join(" ")).toBeDefined();
      const fields = await resolveCommandFields(node!, []);
      const format = fields.find((field) => field.key === "format");
      expect(format?.choices, path.join(" ")).toEqual(choices);
    }
  });

  /**
   * The failure a stated list produced: a `--format` defaulting to a value the
   * group-wide vocabulary did not contain, so the dropdown could not express
   * the value the command would use anyway.
   */
  it("never offers a vocabulary missing the command's own default", async () => {
    const check = async (nodes: readonly WebCommandNode[]): Promise<void> => {
      for (const node of nodes) {
        const fields = await resolveCommandFields(node, []);
        for (const field of fields) {
          if (!field.choices || typeof field.defaultValue !== "string") continue;
          expect(field.choices, `${node.path.join(" ")} --${field.key}`).toContain(
            field.defaultValue
          );
        }
        await check(node.children);
      }
    };
    await check(tree);
  });
});

describe("cost and safety badges", () => {
  it("gates the ceremonies whose damage outlives the run", () => {
    for (const path of [
      ["db", "reset"],
      ["version", "drop-previous"],
      ["version", "drop-next"],
    ]) {
      const annotation = resolveCommandAnnotation(path);
      expect(annotation.badges, path.join(" ")).toContain("destructive");
      expect(annotation.confirm, path.join(" ")).toBeTruthy();
    }
  });

  it("does not gate a command that only reads", () => {
    expect(resolveCommandAnnotation(["db", "status"]).confirm).toBeUndefined();
    expect(resolveCommandAnnotation(["query", "entities"]).badges).toEqual([]);
  });

  it("marks what spends model quota, inheriting the group's other costs", () => {
    const backfill = resolveCommandAnnotation(["extractor", "backfill"]);
    expect(backfill.badges).toContain("ai");

    const forms = resolveCommandAnnotation(["sync", "forms"]);
    expect(forms.badges).toContain("ai");
    // From `sync **`, which the narrower pattern must not shadow.
    expect(forms.badges).toContain("network");
    expect(forms.badges).toContain("slow");
  });
});
