/**
 * Dry-run the scaffolder's questionnaire — no files written, nothing published.
 *
 *   node scripts/try-questionnaire.mjs
 *
 * Runs the REAL prompts from the local `dist` builds, in the same order
 * `npm create refract-theme` asks them: the two project questions, then the shared theme interview.
 * At the end it prints the answers it collected and exits. Use it to judge the interaction without
 * publishing, scaffolding, or clearing an npx cache.
 *
 * Run `pnpm -r build` first if you've edited the prompt code.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const corePath = join(root, "packages/refract/dist/build.esm.js");
const initPath = join(root, "packages/create-refract-theme/dist/index.js");

for (const [label, p] of [["core", corePath], ["create-refract-theme", initPath]]) {
  if (!existsSync(p)) {
    console.error(`Missing ${label} build at ${p}\nRun: pnpm -r build`);
    process.exit(1);
  }
}

const { Prompter, promptCreateAnswers, FEEL_PRESETS, swatch } = await import(corePath);
const { ADAPTERS } = await import(initPath);

// `--frames` prints a still of each prompt shape and exits — enough to judge the layout without
// answering ten questions, and it needs no keyboard.
if (process.argv.includes("--frames")) {
  const ESC = String.fromCharCode(27);
  const dim = s => `${ESC}[2m${s}${ESC}[0m`;
  const bold = s => `${ESC}[1m${s}${ESC}[0m`;
  const green = s => `${ESC}[32m${s}${ESC}[0m`;
  const cyan = s => `${ESC}[36m${s}${ESC}[0m`;

  const frame = (label, choices, { multi, cursor, selected }) => {
    const help = multi ? "↑↓ move · space toggle · a all · enter confirm" : "↑↓ move · enter select";
    const widest = choices.reduce((w, c) => Math.max(w, c.label.length), 0);
    const rows = choices.map((c, i) => {
      const here = i === cursor;
      const caret = here ? green("❯") : " ";
      const box = multi ? (selected.has(i) ? green("[✓]") : dim("[ ]")) : "";
      const name = here ? bold(c.label) : c.label;
      const pad = " ".repeat(Math.max(0, widest - c.label.length));
      const blocks = (c.swatches ?? []).map(s => swatch(s)).filter(Boolean).join(" ");
      const hint = c.hint ? `  ${dim(c.hint)}` : "";
      return `  ${caret} ${box ? `${box} ` : ""}${name}${pad}${blocks ? `  ${blocks}` : ""}${hint}`;
    });
    return [`${cyan("?")} ${bold(label)} ${dim(help)}`, ...rows].join("\n");
  };

  console.log("\n── multi-select · cursor on row 2, two ticked ──\n");
  console.log(frame("Output formats", ADAPTERS.map(a => ({ label: a.label, hint: a.hint })), {
    multi: true, cursor: 1, selected: new Set([0, 2]),
  }));

  console.log("\n\n── single-select with live swatches · the harmony prompt ──\n");
  console.log(frame("Harmony scheme", [
    { label: "analogous", hint: "quiet and cohesive", swatches: ["#4c6ef5", "#0086c2", "#9056e4"] },
    { label: "split-complement", hint: "contrast, less tension", swatches: ["#4c6ef5", "#b96400", "#768700"] },
    { label: "triadic", hint: "three colours of equal weight", swatches: ["#4c6ef5", "#dd352b", "#00973e"] },
  ], { multi: false, cursor: 2, selected: new Set() }));

  console.log("\n\n── single-select, plain ──\n");
  console.log(frame("Overall feel", Object.values(FEEL_PRESETS).map(f => ({ label: f.label, hint: f.blurb })), {
    multi: false, cursor: 0, selected: new Set(),
  }));
  console.log(`\n${swatch("#4c6ef5", 3) ? "" : "  (no swatches — your terminal reports no colour support)"}\n`);
  process.exit(0);
}

const p = new Prompter();

if (!p.interactive) {
  console.error("Not a TTY — run this directly in your terminal, not through a pipe.");
  process.exit(1);
}

p.write();
p.write("  refract · questionnaire dry run");
p.write("  nothing will be written to disk");
p.write();

try {
  // ── the two project questions `create-refract-theme` asks ──
  const name = await p.text("Package name", "my-theme", v =>
    /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(v)
      ? undefined
      : `"${v}" isn't a valid npm package name.`,
  );

  const adapters = await p.multiselect(
    "Output formats",
    ADAPTERS.map(a => ({ value: a.id, label: a.label, hint: a.hint })),
    [0],
  );
  p.write();

  // ── the shared theme interview, exactly as both CLIs run it ──
  const answers = await promptCreateAnswers(p, {});

  p.write();
  p.write("  ── what you chose ──");
  p.write(`     package name : ${name}`);
  p.write(`     formats      : ${adapters.join(", ") || "none"}`);
  for (const [k, v] of Object.entries(answers)) {
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    p.write(`     ${k.padEnd(13)}: ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  p.write();
  p.write(`     feel preset  : ${FEEL_PRESETS[answers.feel]?.blurb ?? "—"}`);
  p.write();
  p.write("  Nothing was written. Run `refract create` (or `npm create refract-theme`) for real.");
  p.write();
} catch (err) {
  p.write();
  p.write(`  ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  p.close();
}
