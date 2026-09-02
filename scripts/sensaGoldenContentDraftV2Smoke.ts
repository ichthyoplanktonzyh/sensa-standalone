import {
  validateGoldenContentDraftV2,
} from '@sensa/content-validator/authoring-draft-v2';
import type { SensaGoldenContentDraftV2Bundle } from '@sensa/contracts/sensa';
import { goldenDraftV2Bundle } from '../apps/web-next/src/content/goldenDraftV2Bundle.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cloneBundle(): SensaGoldenContentDraftV2Bundle {
  return structuredClone(goldenDraftV2Bundle) as SensaGoldenContentDraftV2Bundle;
}

function firstPackage(bundle: SensaGoldenContentDraftV2Bundle, packageKey: string) {
  const item = bundle.packages.find((candidate) => candidate.identity.packageKey === packageKey);
  assert(item, `Missing package ${packageKey}.`);
  return item;
}

function assertInvalid(
  bundle: SensaGoldenContentDraftV2Bundle,
  code: string,
  message: string,
): void {
  const result = validateGoldenContentDraftV2(bundle);
  assert(result.status === 'invalid', `${message} Expected invalid status, got ${result.status}.`);
  assert(result.issues.some((issue) => issue.code === code), `${message} Missing issue ${code}.`);
}

function collectReviewStatuses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectReviewStatuses);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const statuses = typeof record.status === 'string'
      && 'reviewedBy' in record
      ? [record.status]
      : [];
    return [...statuses, ...Object.values(record).flatMap((child) => collectReviewStatuses(child))];
  }
  return [];
}

const valid = validateGoldenContentDraftV2(goldenDraftV2Bundle);
assert(valid.previewable, 'All Draft V2 Golden Packages must remain previewable.');
assert(valid.status === 'incomplete', 'Draft review status must keep the bundle incomplete.');
assert(valid.bundle !== null, 'A valid Draft V2 bundle must return parsed content.');
assert(!valid.issues.some((issue) => issue.severity === 'invalid'), 'Golden Packages must contain no invalid issues.');
assert(valid.bundle.packages.length === 4, 'The diversity fixture must contain four Golden Packages.');
const reviewStatuses = collectReviewStatuses(valid.bundle);
assert(reviewStatuses.length > 0 && reviewStatuses.every((status) => status === 'draft'), 'Every authored Golden resource must remain in draft review.');

const packageKeys = valid.bundle.packages.map((item) => item.identity.packageKey);
for (const expectedKey of [
  'fragile.adj.physical-easily-broken',
  'sustain.verb.process-continue',
  'borrow.verb.receive-temporarily',
  'lend.verb.give-temporarily',
]) {
  assert(packageKeys.includes(expectedKey), `Missing diversity package ${expectedKey}.`);
}

for (const item of valid.bundle.packages) {
  const preferredSelections = item.experience.renderPlan.selections.filter((selection) =>
    selection.role === 'preferred');
  assert(preferredSelections.length === 1, `${item.identity.packageKey} needs exactly one preferred Experience Render.`);
  const preferredRender = item.experience.renders.find((render) =>
    render.renderKey === preferredSelections[0]?.renderKey);
  assert(preferredRender, `${item.identity.packageKey} preferred Render must resolve.`);
  if (preferredRender.kind !== 'text') {
    assert(
      item.experience.renderPlan.selections.some((selection) =>
        selection.role === 'fallback'
        && item.experience.renders.some((render) =>
          render.renderKey === selection.renderKey && render.kind === 'text')),
      `${item.identity.packageKey} non-text preferred Render needs a Text Experience Render fallback.`,
    );
  }
  const requiredKinds = item.acquisitionProfile.requiredCapabilities.map((capability) => capability.kind);
  for (const baselineKind of [
    'contextual_recognition',
    'meaning_to_form_recall',
    'novel_context_transfer',
  ]) {
    assert(requiredKinds.includes(baselineKind), `${item.identity.packageKey} is missing baseline capability ${baselineKind}.`);
  }
  const transferExamples = item.examples.filter((example) => example.roles.includes('transfer_assessment'));
  assert(transferExamples.length >= 5, `${item.identity.packageKey} needs at least five protected Transfer Examples.`);
  assert(
    new Set(transferExamples.map((example) => example.scenarioFamily)).size >= 3,
    `${item.identity.packageKey} needs at least three Transfer scenario families.`,
  );
  assert(item.assessmentInventory.meaningToFormRecall.length >= 1, `${item.identity.packageKey} needs at least one Recall task.`);
  assert(
    item.assessmentInventory.novelContextTransfer.length >= transferExamples.length,
    `${item.identity.packageKey} needs a Transfer task for every protected Example.`,
  );
  assert(item.experience.recap.steps.length >= 2, `${item.identity.packageKey} needs a two-step Experience Recap.`);
  assert(item.usagePatterns.length >= 1, `${item.identity.packageKey} needs a Usage Pattern.`);
  for (const pattern of item.usagePatterns) {
    for (const collocation of pattern.collocations) {
      assert(
        collocation.exampleBindings.filter((binding) => binding.role === 'primary').length === 1,
        `${item.identity.packageKey}/${collocation.collocationKey} needs exactly one primary usage binding.`,
      );
      for (const binding of collocation.exampleBindings) {
        const example = item.examples.find((candidate) => candidate.exampleKey === binding.exampleKey);
        assert(example, `Usage binding ${binding.bindingKey} points to a missing Example.`);
        assert(
          example.textL2.slice(binding.start, binding.end) === collocation.displayTextL2,
          `Usage binding ${binding.bindingKey} must select its exact collocation span.`,
        );
      }
    }
  }
}

const fragile = firstPackage(valid.bundle, 'fragile.adj.physical-easily-broken');
assert(fragile.assessmentInventory.boundaryContrast.length === 0, 'fragile must omit Boundary tasks without a real Relation.');
const preferredKinds = Object.fromEntries(valid.bundle.packages.map((item) => {
  const selection = item.experience.renderPlan.selections.find((candidate) => candidate.role === 'preferred');
  const render = item.experience.renders.find((candidate) => candidate.renderKey === selection?.renderKey);
  return [item.identity.packageKey, render?.kind];
}));
assert(preferredKinds['fragile.adj.physical-easily-broken'] === 'interaction', 'fragile should prefer interaction grounding.');
assert(preferredKinds['sustain.verb.process-continue'] === 'interaction', 'sustain should prefer interaction grounding.');
assert(preferredKinds['borrow.verb.receive-temporarily'] === 'text', 'borrow should prefer a Text Experience Render.');
assert(preferredKinds['lend.verb.give-temporarily'] === 'text', 'lend should prefer a Text Experience Render.');

for (const packageKey of [
  'borrow.verb.receive-temporarily',
  'lend.verb.give-temporarily',
]) {
  const item = firstPackage(valid.bundle, packageKey);
  assert(item.assessmentInventory.boundaryContrast.length >= 1, `${packageKey} needs a Boundary task.`);
  const boundary = item.assessmentInventory.boundaryContrast[0];
  const relation = valid.bundle.relations.find((candidate) => candidate.relationKey === boundary?.relationKey);
  assert(relation?.scope === 'cross_word', `${packageKey} Boundary must use a cross-word Relation.`);
  assert(
    relation.sourceSenseKey === item.identity.senseKey || relation.targetSenseKey === item.identity.senseKey,
    `${packageKey} Boundary Relation must involve its Package Sense.`,
  );
}

const brokenUsageSpan = cloneBundle();
const usageBinding = brokenUsageSpan.packages[0]?.usagePatterns[0]?.collocations[0]?.exampleBindings[0];
assert(usageBinding, 'The fixture must contain a usage binding.');
usageBinding.start += 1;
assertInvalid(brokenUsageSpan, 'usage.span_invalid', 'A changed Usage Example span must invalidate the bundle.');

const usageAssessmentLeak = cloneBundle();
const usagePattern = usageAssessmentLeak.packages[0]?.usagePatterns[0];
const usageCollocation = usagePattern?.collocations[0];
const assessmentExample = usageAssessmentLeak.packages[0]?.examples.find((example) =>
  example.visibility === 'assessment_only' && example.roles.includes('transfer_assessment'));
assert(usageCollocation && assessmentExample, 'The fixture must contain a Usage Pattern and protected Example.');
const leakedBinding = usageCollocation.exampleBindings[0];
leakedBinding.exampleKey = assessmentExample.exampleKey;
assertInvalid(usageAssessmentLeak, 'usage.assessment_resource_exposed', 'A Usage binding to an assessment Example must invalidate the bundle.');

const transferFormLeak = cloneBundle();
const transferPackage = transferFormLeak.packages[0];
const transferTask = transferPackage?.assessmentInventory.novelContextTransfer[0];
const transferLexeme = transferFormLeak.lexemes.find((lexeme) => lexeme.lexemeKey === transferPackage?.identity.lexemeKey);
assert(transferTask && transferLexeme, 'The fixture must contain a Transfer task and pinned Lexeme.');
transferTask.scene.setupL1 = `${transferTask.scene.setupL1} ${transferLexeme.lemma}`;
assertInvalid(transferFormLeak, 'assessment.transfer_target_form_leak', 'A target form in the Transfer scene must invalidate the bundle.');

const falseLabelRecall = cloneBundle();
const recallTask = falseLabelRecall.packages[0]?.assessmentInventory.meaningToFormRecall[0];
const declaredTargetChoice = recallTask?.supportInventory.formChoices.find((choice) => choice.isTargetLexeme);
assert(declaredTargetChoice, 'The fixture must contain a declared target Recall choice.');
declaredTargetChoice.isTargetLexeme = false;
assertInvalid(falseLabelRecall, 'assessment.recall_target_flag_mismatch', 'A false-labelled pinned Recall form must invalidate the bundle.');

const learningOnlyBoundary = cloneBundle();
const boundaryPackage = firstPackage(learningOnlyBoundary, 'borrow.verb.receive-temporarily');
const boundaryTask = boundaryPackage.assessmentInventory.boundaryContrast[0];
const boundaryExample = boundaryPackage.examples.find((example) => example.exampleKey === boundaryTask?.exampleKey);
assert(boundaryTask && boundaryExample, 'The fixture must contain a Boundary task and Example.');
boundaryExample.visibility = 'learning_only';
assertInvalid(learningOnlyBoundary, 'assessment.boundary_example_invalid', 'A learning-only Boundary Example must invalidate the bundle.');

const missingBoundaryTask = cloneBundle();
const borrowPackage = firstPackage(missingBoundaryTask, 'borrow.verb.receive-temporarily');
borrowPackage.assessmentInventory.boundaryContrast.splice(0, 1);
assertInvalid(missingBoundaryTask, 'capability.boundary_task_missing', 'A required Boundary task must not be silently omitted.');

const missingRepairResource = cloneBundle();
const boundaryRepairPackage = firstPackage(missingRepairResource, 'borrow.verb.receive-temporarily');
const boundaryRepairBinding = boundaryRepairPackage.repairBindings.find((binding) =>
  binding.capability === 'boundary_discrimination'
  && binding.resourceRefs.some((resource) => resource.kind === 'sense_relation'));
let missingRepairReferenceRejected = false;
if (boundaryRepairBinding !== undefined) {
  const boundaryRepairRelationRef = boundaryRepairBinding.resourceRefs.find((resource) => resource.kind === 'sense_relation');
  assert(boundaryRepairRelationRef?.kind === 'sense_relation', 'The fixture Boundary Repair binding must contain a Relation reference.');
  boundaryRepairRelationRef.relationKey = 'missing.boundary.relation';
  assertInvalid(missingRepairResource, 'reference.relation_missing', 'A Repair binding to a missing Relation must invalidate the bundle.');
  missingRepairReferenceRejected = true;
}

const firstRun = validateGoldenContentDraftV2(goldenDraftV2Bundle);
const secondRun = validateGoldenContentDraftV2(goldenDraftV2Bundle);
assert(firstRun.status === secondRun.status, 'Repeated validation must keep the same status.');
assert(JSON.stringify(firstRun.issues) === JSON.stringify(secondRun.issues), 'Repeated validation must keep identical ordered issues.');

console.log(JSON.stringify({
  validatorVersion: valid.validatorVersion,
  status: valid.status,
  previewable: valid.previewable,
  packages: valid.bundle.packages.length,
  preferredExperienceKinds: preferredKinds,
  draftReviews: reviewStatuses.length,
  transferCoverage: valid.bundle.packages.map((item) => ({
    packageKey: item.identity.packageKey,
    examples: item.examples.filter((example) => example.roles.includes('transfer_assessment')).length,
    scenarioFamilies: new Set(item.examples.filter((example) => example.roles.includes('transfer_assessment')).map((example) => example.scenarioFamily)).size,
  })),
  fragileBoundaryOmitted: true,
  borrowLendBoundaryValidated: true,
  usageSpanRejected: true,
  usageAssessmentExposureRejected: true,
  transferFormLeakRejected: true,
  falseLabelledRecallRejected: true,
  learningOnlyBoundaryRejected: true,
  missingBoundaryRejected: true,
  missingRepairReferenceRejected,
  deterministicIssues: true,
}, null, 2));
