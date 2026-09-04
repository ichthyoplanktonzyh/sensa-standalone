import {
  PROTOTYPE_LEARNING_TARGETS,
  prototypeContentProvisioning,
  runtimePackageForTarget,
} from '../learningJourney/prototypeLearning';
import { PROTOTYPE_LEARNING_PACKAGES } from '../content/learningCatalog';
import {
  ContentProvisioningRegistry,
  type ContentProvisioningAdapter,
} from './contentProvisioning';

const failures: string[] = [];
let checks = 0;

const check = (label: string, ok: boolean): void => {
  checks += 1;
  if (!ok) failures.push(label);
};

const borrow = PROTOTYPE_LEARNING_TARGETS['borrow-receive'];
const tactful = PROTOTYPE_LEARNING_TARGETS['tactful-expression'];
const compact = prototypeContentProvisioning.resolve(borrow, 'compact_learning_material');
const structured = prototypeContentProvisioning.resolve(borrow, 'structured_learning_package');
const missing = prototypeContentProvisioning.resolve(tactful, 'structured_learning_package');

check('紧凑内容经过 provider 形成有稳定 identity 的冻结 Materialization',
  compact.provisioned
  && compact.materialization?.materializationId === 'prototype-compact:borrow-receive:v1'
  && Object.isFrozen(compact.materialization)
  && Object.isFrozen(compact.materialization.content));
check('结构化包经过同一 seam 形成 Materialization',
  structured.provisioned
  && structured.materialization?.capabilityId === 'structured_learning_package');
const runtimePackage = runtimePackageForTarget(borrow);
check('队列消费的 Runtime Package 就是经过 Provisioning 的冻结副本',
  runtimePackage !== null
  && Object.isFrozen(runtimePackage)
  && Object.isFrozen(runtimePackage.content)
  && runtimePackage !== PROTOTYPE_LEARNING_PACKAGES[0]
  && !('retentionTargetId' in PROTOTYPE_LEARNING_PACKAGES[0]!));
check('没有结构化包时诚实返回 blocked + 未供给，不静默降级',
  missing.view.status === 'blocked'
  && !missing.provisioned
  && missing.materialization === null);

check('未知 capability 直接失败', (() => {
  try {
    prototypeContentProvisioning.resolve(borrow, 'pronunciation_audio');
    return false;
  } catch { return true; }
})());

const adapter: ContentProvisioningAdapter<{ id: string }> = {
  capabilityId: 'duplicate',
  readinessFor: () => ({ status: 'ready', label: 'ready', detail: 'ready' }),
  prepare: (target) => ({
    materializationId: `materialization:${target.id}`,
    materializationVersion: 'v1',
    content: target,
  }),
  validate: () => {},
};
check('重复 capability 在注册时失败', (() => {
  try {
    new ContentProvisioningRegistry([adapter, adapter]);
    return false;
  } catch { return true; }
})());

let validated = false;
const validatingRegistry = new ContentProvisioningRegistry([{ ...adapter,
  capabilityId: 'validated',
  validate: () => { validated = true; },
}]);
validatingRegistry.resolve({ id: 'target' }, 'validated');
check('Registry 在冻结 Materialization 前调用 adapter validation', validated);

const sourceContent = { nested: { value: 1 } };
const ownershipRegistry = new ContentProvisioningRegistry([{ ...adapter,
  capabilityId: 'ownership',
  prepare: () => ({
    materializationId: 'materialization:ownership',
    materializationVersion: 'v1',
    content: sourceContent,
  }),
}]);
const owned = ownershipRegistry.resolve({ id: 'target' }, 'ownership');
check('Registry 冻结自己的副本，不冻结 provider 仍持有的源对象',
  Object.isFrozen(owned.materialization?.content)
  && !Object.isFrozen(sourceContent)
  && !Object.isFrozen(sourceContent.nested));

check('空 Materialization identity/version 由 Registry 内核拒绝', (() => {
  const invalid = new ContentProvisioningRegistry([{ ...adapter,
    capabilityId: 'invalid_materialization',
    prepare: () => ({ materializationId: '', materializationVersion: '', content: {} }),
  }]);
  try {
    invalid.resolve({ id: 'target' }, 'invalid_materialization');
    return false;
  } catch { return true; }
})());

if (failures.length > 0) {
  console.error(`content-provisioning smoke FAILED (${failures.length}/${checks})`);
  failures.forEach((label) => console.error(`  - ${label}`));
  process.exit(1);
}
console.log(`content-provisioning smoke OK (${checks} checks)`);
