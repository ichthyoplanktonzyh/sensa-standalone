/**
 * Learner-owned exclusions from automatic learning planning.
 *
 * An override says whether a Target is eligible to be planned. It is not an
 * assessment, Evidence, a completion fact, a Memory Outcome, or an FSRS write.
 * Keeping this as a structured fact prevents presentation plugins from turning
 * a button such as "already known" into an invented learning result.
 */
export const TARGET_PLANNING_OVERRIDE_KINDS = ['declared_mastery'] as const;

export type TargetPlanningOverrideKind = (typeof TARGET_PLANNING_OVERRIDE_KINDS)[number];

export interface TargetPlanningOverride {
  readonly kind: TargetPlanningOverrideKind;
  readonly source: 'learner';
  /** Operation-ledger identity that created this currently active override. */
  readonly operationId: string;
  readonly createdAt: string;
}

export const hasTargetPlanningOverride = (
  overrides: readonly TargetPlanningOverride[],
  kind: TargetPlanningOverrideKind,
): boolean => overrides.some((override) => override.kind === kind);

export const hasDeclaredMasteryOverride = (
  target: Readonly<{ planningOverrides: readonly TargetPlanningOverride[] }>,
): boolean => hasTargetPlanningOverride(target.planningOverrides, 'declared_mastery');

