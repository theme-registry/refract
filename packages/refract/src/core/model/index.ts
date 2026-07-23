/**
 * Model layer for the clean-room tree (Step 0c).
 *
 * The format-neutral {@link ThemeModel} types + the pure builders that assemble it
 * from normalized properties and interpreted rule-set groups. Ported from
 * `core/common/{model,buildModel}.ts`; the interpreted-recipe shape the builders
 * consume lives in `./interpreted`. No CSS lowering here — that's the CSS adapter (step 1).
 */
export type {
  Literal,
  ShadowLayer,
  TransitionPart,
  StructuredValue,
  Ref,
  ResponsiveQueryKind,
  Orientation,
  PropertyResponsiveOverride,
  PropertyModel,
  VariantModel,
  OverrideCondition,
  RuleSetOverride,
  GlobalsVariant,
  RuleSet,
  RuleSetGroup,
  KeyframeStep,
  Keyframe,
  ContainerModel,
  SubsystemModel,
  ThemeModel,
} from "./model";

export type {
  RecipeDeclarations,
  InterpretedRecipeOverride,
  InterpretedRecipeVariant,
  InterpretedRecipeGroup,
} from "./interpreted";

export {
  buildPropertyModel,
  buildPropertiesModel,
  buildRuleSetFromInterpreted,
  buildRuleSetGroupFromInterpreted,
  pathifyRuleSetGroup,
  pathifyProperties,
  extractComponentReferences,
  buildComponentRuleSetFromInterpreted,
  buildSubsystemModel,
  buildThemeModel,
  buildTokenMap,
} from "./buildModel";

export type {
  SubsystemModelInput,
  BuildThemeModelInput,
} from "./buildModel";

export type {
  MergedResponsiveEntry,
  MergedRuleSet,
  RuleSetReference,
} from "./mergeRuleSet";

export {
  mergeComponentRuleSet,
  parseRuleSetReference,
} from "./mergeRuleSet";
