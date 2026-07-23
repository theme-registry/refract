/**
 * Minimal ambient declarations for the slice of the Figma plugin API that `code.ts` uses. Kept local
 * so the POC has no `@figma/plugin-typings` dependency; for production, install that package and delete
 * this file. Covers only variable-collection creation + the UI message bridge.
 */
type FigmaRGBAValue = { r: number; g: number; b: number; a: number };
type FigmaVariableValue = FigmaRGBAValue | number | string | boolean;
type FigmaResolvedType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";

interface FigmaVariable {
  setValueForMode(modeId: string, value: FigmaVariableValue): void;
}

interface FigmaVariableCollection {
  readonly id: string;
  readonly modes: ReadonlyArray<{ modeId: string; name: string }>;
  renameMode(modeId: string, newName: string): void;
  addMode(name: string): string;
}

interface FigmaVariablesApi {
  createVariableCollection(name: string): FigmaVariableCollection;
  createVariable(name: string, collection: FigmaVariableCollection, resolvedType: FigmaResolvedType): FigmaVariable;
}

interface FigmaUiApi {
  postMessage(msg: unknown): void;
  onmessage: ((msg: unknown) => void) | null;
}

interface FigmaGlobal {
  readonly variables: FigmaVariablesApi;
  readonly ui: FigmaUiApi;
  showUI(html: string, options?: { width?: number; height?: number }): void;
  notify(message: string, options?: { error?: boolean }): void;
  closePlugin(message?: string): void;
}

declare const figma: FigmaGlobal;
declare const __html__: string;
