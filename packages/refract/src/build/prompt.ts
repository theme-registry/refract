/**
 * Interactive prompts over `node:readline` and raw stdin (Node-only).
 *
 * The package ships zero runtime dependencies and this is the build layer, so rather than pull in a
 * prompt library these are the shapes the CLIs actually need, implemented directly.
 *
 * Three tiers, chosen per call:
 *
 *  1. **Raw mode** (a TTY that grants `setRawMode`) — arrow keys move, space toggles, Enter confirms.
 *     What people expect from `npm create`.
 *  2. **Line mode** (a TTY that refuses raw mode — some CI shells, some remote terminals) — the same
 *     questions answered by typing a number. Plainer, but never wedged.
 *  3. **Non-interactive** (no TTY at all: a pipe, CI, `--yes`) — every prompt takes its default
 *     without blocking, so a scripted run can't deadlock on stdin that will never arrive.
 *
 * Key handling is a **pure reducer** (`applyKey`), so navigation is unit-testable without a terminal;
 * the raw loop is only plumbing around it.
 */
import { createInterface, type Interface } from "node:readline";

/** ANSI helpers — no-ops when the stream isn't a TTY, so piped output stays clean. */
const useColor = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, s: string): string => (useColor() ? `\u001b[${code}m${s}\u001b[0m` : s);
export const bold = (s: string): string => paint("1", s);
export const dim = (s: string): string => paint("2", s);
export const cyan = (s: string): string => paint("36", s);
export const green = (s: string): string => paint("32", s);
export const yellow = (s: string): string => paint("33", s);

/** Terminal control, named so the rendering below reads as intent rather than escape soup. */
const cursorUp = (n: number): string => (n > 0 ? `\u001b[${n}A` : "");
const CLEAR_DOWN = "\u001b[0J";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

/** One choice in a `select` / `multiselect`. */
export interface Choice<T> {
  readonly value: T;
  readonly label: string;
  /** Trailing grey note — what this option means. */
  readonly hint?: string;
}

/** The keys a list prompt understands, after decoding an stdin chunk. */
export type ListKey = "up" | "down" | "space" | "submit" | "all" | "cancel" | "none";

/** Decode a raw stdin chunk into a {@link ListKey}. Arrows arrive as escape sequences; j/k mirror vim. */
export function decodeKey(chunk: string): ListKey {
  switch (chunk) {
    case "\u001b[A":
    case "k":
      return "up";
    case "\u001b[B":
    case "j":
      return "down";
    case " ":
      return "space";
    case "\r":
    case "\n":
      return "submit";
    case "a":
      return "all";
    case "\u0003": // Ctrl-C
    case "\u001b": // bare Escape
      return "cancel";
    default:
      return "none";
  }
}

/**
 * Split one stdin chunk into the keys it contains.
 *
 * A held-down arrow key, or fast typing, delivers several sequences in a single `data` event — so
 * decoding the chunk as one key would swallow all but the first and make the list feel like it drops
 * input. Escape sequences (`ESC [ <letter>`) are taken as a unit; everything else is one key each.
 */
export function decodeKeys(chunk: string): ListKey[] {
  const keys: ListKey[] = [];
  for (let i = 0; i < chunk.length; ) {
    if (chunk[i] === "\u001b" && chunk[i + 1] === "[" && i + 2 < chunk.length) {
      keys.push(decodeKey(chunk.slice(i, i + 3)));
      i += 3;
    } else {
      keys.push(decodeKey(chunk[i]));
      i += 1;
    }
  }
  return keys;
}

/** Where a list prompt currently stands. */
export interface ListState {
  readonly cursor: number;
  readonly selected: ReadonlySet<number>;
  readonly done: boolean;
  readonly cancelled: boolean;
}

/**
 * Advance a list prompt by one key. Pure — no I/O — so navigation is testable without a terminal.
 *
 * The cursor **wraps** at both ends: with six options, up from the first should land on the last
 * rather than stick. `space` and `a` toggle only in multi mode; in single mode Enter is the commit,
 * so space would be ambiguous.
 */
export function applyKey(state: ListState, key: ListKey, count: number, multi: boolean): ListState {
  if (state.done || state.cancelled || count === 0) return state;
  switch (key) {
    case "up":
      return { ...state, cursor: (state.cursor - 1 + count) % count };
    case "down":
      return { ...state, cursor: (state.cursor + 1) % count };
    case "space": {
      if (!multi) return state;
      const next = new Set(state.selected);
      if (next.has(state.cursor)) next.delete(state.cursor);
      else next.add(state.cursor);
      return { ...state, selected: next };
    }
    case "all": {
      if (!multi) return state;
      const everything = state.selected.size === count;
      return {
        ...state,
        selected: everything ? new Set() : new Set(Array.from({ length: count }, (_, i) => i)),
      };
    }
    case "submit":
      return { ...state, done: true };
    case "cancel":
      return { ...state, cancelled: true };
    default:
      return state;
  }
}

/** Can we drive the terminal directly? Some TTYs (and most CI) don't grant raw mode. */
const rawCapable = (): boolean =>
  Boolean(process.stdin.isTTY) && typeof process.stdin.setRawMode === "function";

/**
 * A prompt session. Holds at most one readline interface, so stdin is opened and closed once;
 * `interactive` is false when there's no TTY, and every ask short-circuits to its default.
 */
export class Prompter {
  private rl: Interface | undefined;
  readonly interactive: boolean;

  constructor(interactive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)) {
    this.interactive = interactive;
  }

  private get io(): Interface {
    if (!this.rl) this.rl = createInterface({ input: process.stdin, output: process.stdout });
    return this.rl;
  }

  close(): void {
    this.rl?.close();
    this.rl = undefined;
  }

  private question(text: string): Promise<string> {
    return new Promise(resolve => this.io.question(text, answer => resolve(answer)));
  }

  /** Raw write, no newline — for cursor control during a live render. */
  private out(s: string): void {
    process.stdout.write(s);
  }

  /** Print a line. Kept on the prompter so command code never touches `process.stdout`. */
  write(line = ""): void {
    process.stdout.write(`${line}\n`);
  }

  /** Free-text, with a default shown in the prompt. Blank input takes the default. */
  async text(label: string, fallback: string, validate?: (v: string) => string | undefined): Promise<string> {
    if (!this.interactive) return fallback;
    for (;;) {
      const answer = (await this.question(`${cyan("?")} ${bold(label)} ${dim(`(${fallback})`)} `)).trim();
      const value = answer || fallback;
      const error = validate?.(value);
      if (!error) return value;
      this.write(`  ${yellow("!")} ${error}`);
    }
  }

  /** A number, validated as finite. */
  async number(label: string, fallback: number, validate?: (v: number) => string | undefined): Promise<number> {
    const answer = await this.text(label, String(fallback), v => {
      const n = Number(v);
      if (!Number.isFinite(n)) return `"${v}" is not a number.`;
      return validate?.(n);
    });
    return Number(answer);
  }

  /** Pick one — arrows to move, Enter to choose. */
  async select<T>(label: string, choices: readonly Choice<T>[], defaultIndex = 0): Promise<T> {
    if (!this.interactive || choices.length === 1) return choices[defaultIndex]?.value ?? choices[0].value;
    if (rawCapable()) {
      const picked = await this.runList(label, choices, {
        multi: false,
        cursor: defaultIndex,
        selected: new Set<number>(),
      });
      return choices[picked[0] ?? defaultIndex].value;
    }
    return this.selectByNumber(label, choices, defaultIndex);
  }

  /** Pick any — arrows to move, space to toggle, `a` for all/none, Enter to confirm. */
  async multiselect<T>(
    label: string,
    choices: readonly Choice<T>[],
    preselected: readonly number[],
  ): Promise<T[]> {
    if (!this.interactive) return preselected.map(i => choices[i].value);
    if (rawCapable()) {
      const picked = await this.runList(label, choices, {
        multi: true,
        cursor: preselected[0] ?? 0,
        selected: new Set(preselected),
      });
      return picked.map(i => choices[i].value);
    }
    return this.multiselectByNumber(label, choices, preselected);
  }

  /**
   * The raw-mode list loop. Renders in place: each keypress rewinds over the block just drawn and
   * repaints it, so the list stays put instead of scrolling the terminal away.
   *
   * Any readline interface is closed first — it would otherwise swallow the keystrokes we need.
   * `cleanup` always restores the terminal (raw mode off, cursor shown), including on cancel, so a
   * Ctrl-C can't leave the shell in a state where typing is invisible.
   */
  private runList<T>(
    label: string,
    choices: readonly Choice<T>[],
    init: { multi: boolean; cursor: number; selected: Set<number> },
  ): Promise<number[]> {
    this.close(); // readline and raw mode can't both own stdin
    const stdin = process.stdin;
    const { multi } = init;
    let state: ListState = {
      cursor: Math.max(0, Math.min(init.cursor, choices.length - 1)),
      selected: init.selected,
      done: false,
      cancelled: false,
    };
    let painted = 0;

    const help = multi ? "↑↓ move · space toggle · a all · enter confirm" : "↑↓ move · enter select";

    const frame = (): string => {
      const rows = choices.map((c, i) => {
        const here = i === state.cursor;
        const mark = multi ? (state.selected.has(i) ? green("◉") : dim("◯")) : here ? green("❯") : " ";
        const name = here ? bold(c.label) : c.label;
        const hint = c.hint ? ` ${dim(`— ${c.hint}`)}` : "";
        return `  ${mark} ${name}${hint}`;
      });
      return [`${cyan("?")} ${bold(label)} ${dim(help)}`, ...rows].join("\n");
    };

    const paintFrame = (): void => {
      if (painted) this.out(cursorUp(painted) + CLEAR_DOWN);
      const text = frame();
      this.out(`${text}\n`);
      painted = text.split("\n").length;
    };

    return new Promise<number[]>((resolve, reject) => {
      const cleanup = (): void => {
        stdin.removeListener("data", onData);
        stdin.removeListener("end", onEnd);
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        this.out(SHOW_CURSOR);
      };

      /**
       * stdin closed while we were waiting — a piped run, a closed terminal, a killed parent. There
       * is no further input coming, so commit what's on screen instead of blocking forever.
       */
      const onEnd = (): void => {
        const chosen = multi ? [...state.selected].sort((a, b) => a - b) : [state.cursor];
        this.out(cursorUp(painted) + CLEAR_DOWN);
        cleanup();
        resolve(chosen);
      };

      const onData = (chunk: string): void => {
        // One event can carry several keys (a held-down arrow); apply them all, then paint once.
        for (const key of decodeKeys(chunk)) {
          state = applyKey(state, key, choices.length, multi);
          if (state.done || state.cancelled) break;
        }

        if (state.cancelled) {
          this.out(cursorUp(painted) + CLEAR_DOWN);
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }

        if (state.done) {
          const chosen = multi ? [...state.selected].sort((a, b) => a - b) : [state.cursor];
          // Replace the live block with a one-line record of the answer, so a finished interview
          // reads back as a transcript rather than a wall of spent menus.
          this.out(cursorUp(painted) + CLEAR_DOWN);
          const summary = chosen.length ? chosen.map(i => choices[i].label).join(", ") : "none";
          this.write(`${cyan("?")} ${bold(label)} ${dim("›")} ${green(summary)}`);
          cleanup();
          resolve(chosen);
          return;
        }

        paintFrame();
      };

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      this.out(HIDE_CURSOR);
      stdin.on("data", onData);
      stdin.on("end", onEnd);
      paintFrame();
    });
  }

  /** Line-mode fallback: pick one by number. */
  private async selectByNumber<T>(
    label: string,
    choices: readonly Choice<T>[],
    defaultIndex: number,
  ): Promise<T> {
    this.write(`${cyan("?")} ${bold(label)}`);
    choices.forEach((c, i) => {
      const marker = i === defaultIndex ? green("❯") : " ";
      const hint = c.hint ? ` ${dim(`— ${c.hint}`)}` : "";
      this.write(`  ${marker} ${dim(`${i + 1}.`)} ${i === defaultIndex ? bold(c.label) : c.label}${hint}`);
    });
    for (;;) {
      const answer = (await this.question(`  ${dim(`1–${choices.length}`)} `)).trim();
      if (!answer) return choices[defaultIndex].value;
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value;
      this.write(`  ${yellow("!")} Enter a number between 1 and ${choices.length}.`);
    }
  }

  /** Line-mode fallback: pick any by comma-separated numbers. */
  private async multiselectByNumber<T>(
    label: string,
    choices: readonly Choice<T>[],
    preselected: readonly number[],
  ): Promise<T[]> {
    this.write(`${cyan("?")} ${bold(label)} ${dim('(comma-separated, blank = keep, "none" = clear)')}`);
    choices.forEach((c, i) => {
      const on = preselected.includes(i);
      const hint = c.hint ? ` ${dim(`— ${c.hint}`)}` : "";
      this.write(`  ${on ? green("◉") : dim("◯")} ${dim(`${i + 1}.`)} ${c.label}${hint}`);
    });
    for (;;) {
      const answer = (await this.question(`  ${dim(`1–${choices.length}`)} `)).trim().toLowerCase();
      if (!answer) return preselected.map(i => choices[i].value);
      if (answer === "none") return [];
      const parts = answer.split(",").map(s => Number(s.trim()) - 1);
      if (parts.every(i => Number.isInteger(i) && i >= 0 && i < choices.length)) {
        return parts.map(i => choices[i].value);
      }
      this.write(`  ${yellow("!")} Enter numbers between 1 and ${choices.length}, separated by commas.`);
    }
  }
}
