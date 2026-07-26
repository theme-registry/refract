/**
 * Minimal interactive prompts over `node:readline` (Node-only).
 *
 * The package ships zero runtime dependencies and this is the build layer, so rather than pull in a
 * prompt library for one command these are the four shapes the CLI actually needs. They are
 * line-based, not raw-mode: you type a number or a value and press Enter. That loses arrow-key
 * navigation, and buys a prompt that behaves predictably over SSH, in CI logs, in a Docker build,
 * and under any terminal that doesn't grant raw mode — where a fancier prompt would hang or garble.
 *
 * Every prompt is **non-interactive-safe**: with no TTY (a pipe, CI, `--yes`) it takes the default
 * without blocking, so a scripted run never deadlocks waiting on stdin that will never arrive.
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

/** One choice in a `select` / `multiselect`. */
export interface Choice<T> {
  readonly value: T;
  readonly label: string;
  /** Trailing grey note — what this option means. */
  readonly hint?: string;
}

/**
 * A prompt session. Holds one readline interface for the whole interview so stdin is opened and
 * closed exactly once; `interactive` is false when there's no TTY, and every ask short-circuits to
 * its default.
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

  /** Print a line to stdout. Kept on the prompter so command code never touches `process.stdout`. */
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

  /** Pick one. Answers are 1-based indices; blank takes the default (the first choice unless given). */
  async select<T>(label: string, choices: readonly Choice<T>[], defaultIndex = 0): Promise<T> {
    if (!this.interactive || choices.length === 1) return choices[defaultIndex]?.value ?? choices[0].value;
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

  /**
   * Pick any. Answers are comma-separated indices; blank keeps the pre-selected set, and an explicit
   * `none` clears it — otherwise there'd be no way to deselect everything with a line-based prompt.
   */
  async multiselect<T>(label: string, choices: readonly Choice<T>[], preselected: readonly number[]): Promise<T[]> {
    if (!this.interactive) return preselected.map(i => choices[i].value);
    this.write(`${cyan("?")} ${bold(label)} ${dim("(comma-separated, blank = keep, \"none\" = clear)")}`);
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
