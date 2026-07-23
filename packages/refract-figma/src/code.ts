/// <reference path="./figma-env.d.ts" />
/**
 * refract → Figma plugin — the sandbox entry (the thin `figma.*` glue). It receives a DTCG document
 * (or a `{ modes: [...] }` set) from the UI, builds a {@link VariablePlan} with the pure transform,
 * and writes a Figma Variable collection: one mode per input, one variable per token, folder-nested by
 * its slash path. All the mapping logic lives in `plan.ts` (tested); this file only executes it.
 */
import { buildVariablePlan, type ModeInput, type VariablePlan } from "./plan";

interface CreateMessage {
  type: "create";
  collection?: string;
  modes: ModeInput[];
}

figma.showUI(__html__, { width: 400, height: 500 });

figma.ui.onmessage = (raw: unknown) => {
  const msg = raw as CreateMessage;
  if (!msg || msg.type !== "create") return;
  try {
    const plan = buildVariablePlan(msg.collection || "refract", msg.modes || []);
    const created = applyPlan(plan);
    figma.ui.postMessage({ type: "done", created, modes: plan.modes, warnings: plan.warnings });
    figma.notify(`refract: ${created} variable(s) across ${plan.modes.length} mode(s)`);
  } catch (err) {
    const message = (err as Error).message;
    figma.ui.postMessage({ type: "error", message });
    figma.notify(`refract: ${message}`, { error: true });
  }
};

/** Execute a plan against the Figma variables API. Returns the number of variables created. */
function applyPlan(plan: VariablePlan): number {
  if (plan.modes.length === 0) throw new Error("no modes to import — paste a DTCG document first");
  const collection = figma.variables.createVariableCollection(plan.collection);

  // Map each plan mode to a Figma mode id: reuse the auto-created default for the first, add the rest.
  const modeIds: Record<string, string> = {};
  plan.modes.forEach((name, i) => {
    if (i === 0) {
      collection.renameMode(collection.modes[0].modeId, name);
      modeIds[name] = collection.modes[0].modeId;
    } else {
      modeIds[name] = collection.addMode(name);
    }
  });

  let created = 0;
  for (const variable of plan.variables) {
    const handle = figma.variables.createVariable(variable.name, collection, variable.type);
    for (const [modeName, value] of Object.entries(variable.valuesByMode)) {
      handle.setValueForMode(modeIds[modeName], value);
    }
    created++;
  }
  return created;
}
