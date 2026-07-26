// Release guard for the 0.x lockstep group. The four adapters peer-depend on core via `workspace:^`
// (published as `^0.1.x`), so a `minor`/`major` changeset pushes core OUT of that peer range and
// Changesets cascades the WHOLE fixed group to `1.0.0` at `changeset version` time — the surprise that
// forced the first release to be hand-published. Through 0.x we release patch-only; features are
// communicated in the CHANGELOG, and the first real minor/major is the 1.0 split (see RELEASING.md).
//
// This runs before `changeset version` (and in CI): while the group is on 0.x, it fails if any pending
// changeset declares a `minor` or `major` bump. Once core reaches 1.0 it is a no-op.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreVersion = JSON.parse(readFileSync(`${root}/packages/refract/package.json`, "utf8")).version;
const preOne = Number(coreVersion.split(".")[0]) === 0;

if (!preOne) {
  console.log(`guard-changesets: core is ${coreVersion} (>= 1.0) — minor/major changesets allowed, nothing to guard.`);
  process.exit(0);
}

// The cascade this guard exists to prevent is a property of the FIXED GROUP: those packages
// peer-depend on core, so bumping core out of their range drags the whole group to 1.0.0. A package
// outside the group has no such coupling — its version moves on its own, and holding it to patch-only
// would mean it could never ship a feature release without disabling this check. So the guard reads
// the group from the Changesets config rather than assuming every workspace package is in it.
const fixedGroups = JSON.parse(readFileSync(`${root}/.changeset/config.json`, "utf8")).fixed ?? [];
const inFixedGroup = new Set(fixedGroups.flat());

const dir = `${root}/.changeset`;
const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md");
const offenders = [];
for (const f of files) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  const fm = src.match(/^---\s*([\s\S]*?)\s*---/); // frontmatter block
  if (!fm) continue;
  for (const m of fm[1].matchAll(/^\s*"([^"]+)"\s*:\s*(patch|minor|major)\s*$/gm)) {
    const [, pkg, level] = m;
    if (!inFixedGroup.has(pkg)) continue; // outside the lockstep group — not this guard's business
    if (level === "minor" || level === "major") offenders.push({ file: f, pkg, level });
  }
}

if (offenders.length) {
  console.error(`\n✗ guard-changesets: core is ${coreVersion} (0.x) — only \`patch\` changesets are allowed here.\n`);
  for (const o of offenders) console.error(`    ${o.file}: "${o.pkg}" declares "${o.level}"`);
  console.error(
    `\n  A \`minor\`/\`major\` bump pushes core out of the adapters' \`^0.${coreVersion.split(".")[1]}.x\` peer range and\n` +
      `  cascades the fixed group to 1.0.0. Through 0.x, release patch-only; put feature notes in the\n` +
      `  CHANGELOG. The first minor/major is the 1.0 split — see RELEASING.md.\n`,
  );
  process.exit(1);
}

console.log(`guard-changesets: ${files.length} pending changeset(s); every fixed-group bump is \`patch\` — OK for the 0.x group.`);
