/**
 * Gate for the interactive prompt navigation.
 *
 * The raw-mode loop can't be driven without a TTY, so the key handling is a pure reducer and this
 * tests that directly: decoding stdin chunks into keys, and the cursor/selection state machine.
 * Everything a finger does — arrows, wrapping, space, `a`, Enter, Ctrl-C — is covered here.
 */
import { describe, expect, it } from "vitest";
import { applyKey, decodeKey, decodeKeys, Prompter, type ListKey, type ListState } from "@theme-registry/refract/build";

const start = (over: Partial<ListState> = {}): ListState => ({
  cursor: 0,
  selected: new Set<number>(),
  done: false,
  cancelled: false,
  ...over,
});

/** Feed a sequence of keys through the reducer. */
const drive = (keys: readonly ListKey[], count: number, multi: boolean, from = start()): ListState =>
  keys.reduce((s, k) => applyKey(s, k, count, multi), from);

describe("decodeKey", () => {
  it("decodes the arrow escape sequences", () => {
    expect(decodeKey("\u001b[A")).toBe("up");
    expect(decodeKey("\u001b[B")).toBe("down");
  });

  it("accepts vim keys as well as arrows", () => {
    expect(decodeKey("k")).toBe("up");
    expect(decodeKey("j")).toBe("down");
  });

  it("decodes toggling, confirming and cancelling", () => {
    expect(decodeKey(" ")).toBe("space");
    expect(decodeKey("a")).toBe("all");
    expect(decodeKey("\r")).toBe("submit");
    expect(decodeKey("\n")).toBe("submit");
    expect(decodeKey("\u0003")).toBe("cancel"); // Ctrl-C
    expect(decodeKey("\u001b")).toBe("cancel"); // bare Escape
  });

  it("ignores anything else rather than guessing", () => {
    expect(decodeKey("z")).toBe("none");
    expect(decodeKey("\u001b[C")).toBe("none"); // right arrow
    expect(decodeKey("")).toBe("none");
  });
});

describe("applyKey — moving", () => {
  it("moves down and up", () => {
    expect(drive(["down", "down"], 4, false).cursor).toBe(2);
    expect(drive(["down", "down", "up"], 4, false).cursor).toBe(1);
  });

  it("wraps at both ends", () => {
    // Up from the first lands on the last — sticking would feel broken.
    expect(drive(["up"], 4, false).cursor).toBe(3);
    expect(drive(["down", "down", "down", "down"], 4, false).cursor).toBe(0);
  });

  it("starts from the given cursor", () => {
    expect(drive(["down"], 6, false, start({ cursor: 4 })).cursor).toBe(5);
  });

  it("does nothing with no choices", () => {
    expect(drive(["down", "up", "submit"], 0, false)).toEqual(start());
  });
});

describe("applyKey — single select", () => {
  it("submits the cursor", () => {
    const s = drive(["down", "submit"], 3, false);
    expect(s.done).toBe(true);
    expect(s.cursor).toBe(1);
  });

  it("ignores space and `a` — Enter is the commit", () => {
    const s = drive(["space", "all"], 3, false);
    expect(s.selected.size).toBe(0);
    expect(s.done).toBe(false);
  });

  it("freezes once done", () => {
    const s = drive(["submit", "down", "down"], 3, false);
    expect(s.cursor).toBe(0);
  });
});

describe("applyKey — multi select", () => {
  it("toggles the item under the cursor", () => {
    const s = drive(["space", "down", "space"], 4, true);
    expect([...s.selected].sort()).toEqual([0, 1]);
  });

  it("toggles off again", () => {
    const s = drive(["space", "space"], 4, true);
    expect(s.selected.size).toBe(0);
  });

  it("`a` selects all, then clears", () => {
    expect([...drive(["all"], 3, true).selected].sort()).toEqual([0, 1, 2]);
    expect(drive(["all", "all"], 3, true).selected.size).toBe(0);
  });

  it("keeps a preselected set and lets it be extended", () => {
    const s = drive(["down", "down", "space"], 4, true, start({ selected: new Set([0]) }));
    expect([...s.selected].sort()).toEqual([0, 2]);
  });

  it("can be confirmed empty — deselecting everything is a valid answer", () => {
    const s = drive(["space", "submit"], 3, true, start({ selected: new Set([0]) }));
    expect(s.done).toBe(true);
    expect(s.selected.size).toBe(0);
  });
});

describe("applyKey — cancelling", () => {
  it("cancels on Ctrl-C and stops responding", () => {
    const s = drive(["cancel", "down", "submit"], 3, false);
    expect(s.cancelled).toBe(true);
    expect(s.done).toBe(false);
    expect(s.cursor).toBe(0);
  });
});

describe("Prompter — non-interactive safety", () => {
  it("takes defaults without touching stdin", async () => {
    const p = new Prompter(false);
    const choices = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ];
    expect(await p.text("Colour", "#4c6ef5")).toBe("#4c6ef5");
    expect(await p.number("Size", 16)).toBe(16);
    expect(await p.select("Pick", choices, 1)).toBe("b");
    expect(await p.multiselect("Pick any", choices, [0, 2])).toEqual(["a", "c"]);
    p.close();
  });

  it("skips a single-option select without prompting", async () => {
    const p = new Prompter(true); // interactive, but one option needs no question
    expect(await p.select("Only", [{ value: "x", label: "X" }])).toBe("x");
    p.close();
  });
});

describe("decodeKeys — one event, several keys", () => {
  it("splits a held-down arrow into repeats", () => {
    const ESC = String.fromCharCode(27);
    expect(decodeKeys(ESC + "[B" + ESC + "[B" + ESC + "[B")).toEqual(["down", "down", "down"]);
  });

  it("splits mixed keys, including the terminating Enter", () => {
    const ESC = String.fromCharCode(27);
    expect(decodeKeys(ESC + "[B" + " " + "\r")).toEqual(["down", "space", "submit"]);
  });

  it("handles a single key and an empty chunk", () => {
    expect(decodeKeys("j")).toEqual(["down"]);
    expect(decodeKeys("")).toEqual([]);
  });
});
