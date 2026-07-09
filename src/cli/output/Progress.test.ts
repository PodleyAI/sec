import { describe, expect, it } from "vitest";
import { createProgress, createSpinner, statusMessage } from "./Progress";

describe("statusMessage", () => {
  it("formats success with checkmark prefix", () => {
    expect(statusMessage("success", "Done")).toBe("v Done");
  });

  it("formats error with x prefix", () => {
    expect(statusMessage("error", "Failed")).toBe("x Failed");
  });

  it("formats info with arrow prefix", () => {
    expect(statusMessage("info", "Loading")).toBe("-> Loading");
  });

  it("formats warn with exclamation prefix", () => {
    expect(statusMessage("warn", "Careful")).toBe("! Careful");
  });
});

describe("createProgress", () => {
  it("starts with current at 0", () => {
    const tracker = createProgress({ total: 100, label: "Files" });
    expect(tracker.current).toBe(0);
  });

  it("stores total from options", () => {
    const tracker = createProgress({ total: 50, label: "Items" });
    expect(tracker.total).toBe(50);
  });

  it("increments by 1 by default", () => {
    const tracker = createProgress({ total: 10, label: "Steps" });
    tracker.increment();
    expect(tracker.current).toBe(1);
  });

  it("increments by a specified amount", () => {
    const tracker = createProgress({ total: 10, label: "Steps" });
    tracker.increment(5);
    expect(tracker.current).toBe(5);
  });

  it("caps current at total", () => {
    const tracker = createProgress({ total: 3, label: "Tasks" });
    tracker.increment(10);
    expect(tracker.current).toBe(3);
  });

  it("renders with label and counts", () => {
    const tracker = createProgress({ total: 200, label: "Files" });
    tracker.increment(50);
    const output = tracker.render();
    expect(output).toContain("Files");
    expect(output).toContain("50/200");
  });

  it("renders a percentage", () => {
    const tracker = createProgress({ total: 200, label: "Files" });
    tracker.increment(100);
    const output = tracker.render();
    expect(output).toContain("50%");
  });

  it("renders a visual bar", () => {
    const tracker = createProgress({ total: 10, label: "Items" });
    tracker.increment(5);
    const output = tracker.render();
    // The bar should contain filled and unfilled characters
    expect(output).toMatch(/[#=]+/);
  });
});

describe("createSpinner", () => {
  it("stores the initial message", () => {
    const spinner = createSpinner("Loading...");
    expect(spinner.message).toBe("Loading...");
  });

  it("update changes the message", () => {
    const spinner = createSpinner("Loading...");
    spinner.update("Almost done...");
    expect(spinner.message).toBe("Almost done...");
  });

  it("done returns a success status message", () => {
    const spinner = createSpinner("Loading...");
    const result = spinner.done("Complete");
    expect(result).toBe("v Complete");
  });

  it("fail returns an error status message", () => {
    const spinner = createSpinner("Loading...");
    const result = spinner.fail("Something broke");
    expect(result).toBe("x Something broke");
  });
});
