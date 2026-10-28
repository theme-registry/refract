---
"@theme-registry/refract": patch
---

Importers are pluggable: change one placement rule without forking the rest.

**New: `defineImporter({ name, version, extends?, parse?, place?, value?, finalize? })`.** Each hook you leave out comes from the importer you extend (default `dtcgImporter`, the rules `refract import` has always used); each hook you write receives that importer's hook as `next`, so it handles its own case and hands the rest back. Pass the result as `importDTCG(doc, { importer })` or `fromDTCG(doc, { importer })`.

**New: `refract import tokens.json --importer <dtcg | ./path/to/importer.ts>`.** A path loads a `.ts`/`.mjs`/`.js` module whose default export is an importer. The generated `theme.raw.ts` now says which importer produced it.

**The report stays complete whatever the hooks do.** The engine, not the hooks, collects members, picks bases, renames collisions and writes the report: a token no hook places, or whose value comes back empty, is listed in `unmapped`. Composite tokens (shadow, typography, border, transition) are read after every other token, so `ctx.placed(id)` returns final paths.

**Experimental.** The importer contract may change in a patch release while it settles; a breaking change bumps `IMPORTER_CONTRACT_VERSION`. DTCG import with the default importer stays Stable. The full reference is in `docs/extending.md` ("Writing an importer") and on the site's DTCG page.

**Versioned like adapters.** An importer pins `version` (`IMPORTER_CONTRACT_VERSION`, now `1`); one written against another version throws the new `REFRACT_E_IMPORTER`.

The default importer's output is unchanged; `report.bases` is now listed in property order. The `./dtcg` size budget rises to 10 KB gzip.
