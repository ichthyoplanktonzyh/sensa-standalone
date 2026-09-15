/**
 * Stable component-level presentation contract.
 *
 * Product code owns anatomy, content, behavior and accessibility. A curated
 * skin implements the CSS tokens consumed by these families; it never selects
 * a different renderer or changes a component's meaning.
 */
export const componentSkinContractVersion = "sensa-component-skin-v1" as const;

export const componentFamilyContract = {
  action: ["primary", "secondary", "quiet", "danger"],
  field: ["default", "invalid"],
  surface: ["card", "raised", "media"],
  selection: ["choice", "tab", "chip"],
  overlay: ["dialog", "sheet", "popover"],
  feedback: ["success", "warning", "danger", "info"],
  navigation: ["bar", "tabs"],
  learning: ["prompt", "response", "reveal", "assessment", "completion"],
} as const;

export const componentSlotContract = {
  action: ["leading", "label", "trailing"],
  field: ["label", "control", "help", "error"],
  surface: ["header", "body", "footer"],
  selection: ["indicator", "label", "support"],
  overlay: ["backdrop", "panel", "header", "body", "footer"],
  feedback: ["icon", "message", "action"],
  navigation: ["leading", "title", "items", "trailing"],
  learning: ["eyebrow", "expression", "sense", "support", "actions"],
} as const;

export const componentStateCatalog = ["rest", "selected", "loading", "invalid", "disabled"] as const;

export type ComponentFamily = keyof typeof componentFamilyContract;
export type ComponentVariant<Family extends ComponentFamily> =
  (typeof componentFamilyContract)[Family][number];
export type ComponentSlot<Family extends ComponentFamily> =
  (typeof componentSlotContract)[Family][number];
export type ComponentState = (typeof componentStateCatalog)[number];

export const componentTokenCatalog = [
  "control-target-size",
  "control-inline-inset",
  "control-block-inset",
  "control-gap",
  "action-radius",
  "action-font-weight",
  "action-primary-background",
  "action-primary-foreground",
  "action-primary-border",
  "action-primary-hover-background",
  "action-secondary-background",
  "action-secondary-foreground",
  "action-secondary-border",
  "action-secondary-hover-background",
  "action-quiet-background",
  "action-quiet-foreground",
  "action-quiet-border",
  "action-quiet-hover-background",
  "action-danger-background",
  "action-danger-foreground",
  "action-danger-border",
  "action-danger-hover-background",
  "field-radius",
  "field-background",
  "field-foreground",
  "field-border",
  "field-hover-border",
  "field-focus-border",
  "field-placeholder",
  "surface-card-radius",
  "surface-card-background",
  "surface-card-border",
  "surface-card-shadow",
  "surface-card-inset",
  "surface-raised-background",
  "surface-raised-border",
  "surface-raised-shadow",
  "surface-media-background",
  "surface-media-foreground",
  "selection-radius",
  "selection-background",
  "selection-foreground",
  "selection-border",
  "selection-selected-background",
  "selection-selected-foreground",
  "selection-selected-border",
  "overlay-radius",
  "overlay-background",
  "overlay-border",
  "overlay-shadow",
  "overlay-backdrop",
  "navigation-background",
  "navigation-foreground",
  "navigation-border",
  "feedback-radius",
  "feedback-inset",
  "feedback-success-background",
  "feedback-success-foreground",
  "feedback-success-border",
  "feedback-warning-background",
  "feedback-warning-foreground",
  "feedback-warning-border",
  "feedback-danger-background",
  "feedback-danger-foreground",
  "feedback-danger-border",
  "feedback-info-background",
  "feedback-info-foreground",
  "feedback-info-border",
  "learning-radius",
  "learning-inset",
  "learning-prompt-background",
  "learning-prompt-border",
  "learning-response-background",
  "learning-response-border",
  "learning-reveal-background",
  "learning-reveal-border",
  "learning-assessment-background",
  "learning-assessment-border",
  "learning-completion-background",
  "learning-completion-border",
  "motion-duration",
  "motion-easing",
  "motion-press-scale",
] as const;

export type ComponentToken = (typeof componentTokenCatalog)[number];

export function componentAttributes<Family extends ComponentFamily>(
  family: Family,
  variant: ComponentVariant<Family>,
  states: readonly ComponentState[] = ["rest"],
) {
  return {
    "data-sensa-component": family,
    "data-sensa-variant": variant,
    "data-sensa-state": states.join(" "),
  } as const;
}

export function componentSlot<Family extends ComponentFamily>(slot: ComponentSlot<Family>) {
  return { "data-sensa-slot": slot } as const;
}
