import {
  prototypeLearningRuntimeComposition,
  prototypeLearningRuntimeCompositionGraph,
  validateLearningRuntimeComposition,
} from './runtimeComposition';
import {
  ProtocolPolicyRegistry,
  PROTOCOL_POLICY_INVENTORY,
} from './protocolPolicies';

const summary = prototypeLearningRuntimeComposition;
const counts = Object.values(summary);
if (counts.some((count) => count <= 0)) {
  console.error('runtime-composition smoke FAILED', summary);
  process.exit(1);
}

const failures: string[] = [];
let checks = 1;

const checkThrows = (label: string, run: () => void): void => {
  checks += 1;
  try {
    run();
    failures.push(label);
  } catch {
    // expected fail-closed behavior
  }
};

checkThrows('missing content capability', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  contentCapabilityIds: ['compact_learning_material'],
}));
checkThrows('missing renderer', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  stepKinds: prototypeLearningRuntimeCompositionGraph.stepKinds.filter(
    (stepKind) => stepKind !== 'recognition',
  ),
}));
checkThrows('missing orchestration', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  orchestrations: prototypeLearningRuntimeCompositionGraph.orchestrations.filter(
    (orchestration) => orchestration.orchestrationId !== 'structured_acquisition',
  ),
}));
checkThrows('missing runtime surface', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  surfaces: prototypeLearningRuntimeCompositionGraph.surfaces.filter(
    (surface) => surface.surface !== 'structured_session',
  ),
}));
checkThrows('missing retention store', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  retentionStores: prototypeLearningRuntimeCompositionGraph.retentionStores.filter(
    (store) => store.storeId !== 'scheduler_memory',
  ),
}));
checkThrows('empty profile registry', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  profiles: [],
}));
checkThrows('missing progression policy', () => validateLearningRuntimeComposition({
  ...prototypeLearningRuntimeCompositionGraph,
  protocolPolicies: new ProtocolPolicyRegistry({
    ...PROTOCOL_POLICY_INVENTORY,
    progressionPolicies: PROTOCOL_POLICY_INVENTORY.progressionPolicies.filter(
      (policy) => policy.progressionPolicyId !== 'structured-current-checkpoint-reset-v1',
    ),
  }),
}));

if (failures.length > 0) {
  console.error(`runtime-composition smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}

console.log(`runtime-composition smoke OK (${checks} checks; ${JSON.stringify(summary)})`);
