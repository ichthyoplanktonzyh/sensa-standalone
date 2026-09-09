/**
 * Executable design model only: consumes already domain-validated synthetic facts.
 * Not a production import API, sync wire contract, authentication or FSRS engine.
 * Conflict classification is intentionally separated from future adjudication.
 */
export type RetentionIdentity = {
  learnerId: string; senseId: string; bindingId: string; scope: string;
};
export type Body =
  | { kind: 'meaning.accepted'; meaningId: string; alignmentVersion: string }
  | { kind: 'meaning.corrected'; meaningId: string; alignmentVersion: string; previous: string }
  | { kind: 'meaning.removed'; meaningId: string }
  | { kind: 'meaning.restored'; meaningId: string; removal: string }
  | { kind: 'scheduling.handoff'; target: RetentionIdentity }
  | { kind: 'review.completed'; target: RetentionIdentity; basis: string; runId: string; grade: 'again' | 'hard' | 'good' | 'easy' };
export type Fact = {
  format: string; libraryId: string; id: string; deviceId: string;
  operationId: string; parents: string[]; occurredAt: string; body: Body;
};
export const format = 'sensa-fact-model-lab-v1';
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function retentionKey(target: RetentionIdentity): string {
  return canonical(target); // No material version, source port, device or Profile in this identity.
}
export function inspectFacts(libraryId: string, deliveries: Fact[]) {
  const rejectedLibraries = sorted(deliveries.filter(f => f.libraryId !== libraryId).map(f => f.libraryId));
  const variants = new Map<string, Map<string, Fact>>();
  for (const fact of deliveries.filter(f => f.libraryId === libraryId)) {
    const values = variants.get(fact.id) ?? new Map<string, Fact>();
    values.set(canonical(fact), fact);
    variants.set(fact.id, values);
  }
  const collisions = sorted([...variants].filter(([, v]) => v.size > 1).map(([id]) => id));
  const unknown: string[] = [], ready = new Map<string, Fact>(), pending = new Map<string, Fact>();
  for (const id of sorted(variants.keys())) {
    const values = variants.get(id)!;
    if (values.size !== 1) continue;
    const fact = [...values.values()][0]!;
    if (fact.format !== format) unknown.push(id);
    else pending.set(id, fact);
  }
  // A causal topological admission, independent of delivery order and wall clocks.
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const [id, fact] of pending) {
      if (fact.parents.every(p => ready.has(p))) {
        ready.set(id, fact); pending.delete(id); advanced = true;
      }
    }
  }
  const ancestor = (id: string, candidate: string): boolean => {
    const seen = new Set<string>(), work = [...(ready.get(id)?.parents ?? [])];
    while (work.length) {
      const p = work.pop()!;
      if (p === candidate) return true;
      if (!seen.has(p)) { seen.add(p); work.push(...(ready.get(p)?.parents ?? [])); }
    }
    return false;
  };
  const invalid = new Set<string>();
  for (const [id, f] of ready) {
    const b = f.body;
    if (b.kind === 'meaning.corrected') {
      const previous = ready.get(b.previous)?.body;
      if (!ancestor(id, b.previous) || !previous || !('alignmentVersion' in previous) || previous.meaningId !== b.meaningId) invalid.add(id);
    }
    if (b.kind === 'meaning.restored') {
      const removal = ready.get(b.removal)?.body;
      if (!ancestor(id, b.removal) || removal?.kind !== 'meaning.removed' || removal.meaningId !== b.meaningId) invalid.add(id);
    }
    if (b.kind === 'review.completed') {
      const basis = ready.get(b.basis)?.body;
      if (!ancestor(id, b.basis) || basis?.kind !== 'scheduling.handoff' || retentionKey(basis.target) !== retentionKey(b.target)) invalid.add(id);
    }
  }
  for (const id of ready.keys()) {
    if ([...invalid].some(bad => ancestor(id, bad))) invalid.add(id);
  }
  const usable = [...ready.values()].filter(f => !invalid.has(f.id));
  const meanings = sorted(usable.flatMap(f => 'meaningId' in f.body ? [f.body.meaningId] : [])).map(meaningId => {
    const records = usable.filter(f => 'meaningId' in f.body && f.body.meaningId === meaningId);
    const alignments = records.filter(f => 'alignmentVersion' in f.body);
    const heads = alignments.filter(f => !alignments.some(other => other.id !== f.id && ancestor(other.id, f.id)));
    const removals = records.filter(f => f.body.kind === 'meaning.removed');
    const restored = records.filter(f => f.body.kind === 'meaning.restored');
    const unresolvedRemovals = removals.filter(r => !restored.some(f => ancestor(f.id, r.id)));
    return { meaningId, alignmentHeads: sorted(heads.map(f => f.id)), conflict: heads.length > 1, removed: unresolvedRemovals.length > 0 };
  });
  const reviews = usable.filter(f => f.body.kind === 'review.completed');
  const groups = new Map<string, string[]>();
  for (const f of reviews) {
    if (f.body.kind !== 'review.completed') continue;
    // Same stable target and schedule basis denote one due opportunity in this bounded model.
    const key = canonical([retentionKey(f.body.target), f.body.basis]);
    groups.set(key, [...(groups.get(key) ?? []), f.id]);
  }
  const dueOpportunities = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, ids]) => ({
    key, records: sorted(ids), status: ids.length > 1 ? 'requires_adjudication' : 'single_candidate',
  }));
  return {
    records: sorted(variants.keys()), collisions, unknown, rejectedLibraries,
    pending: sorted(pending.keys()), invalid: sorted(invalid), meanings, dueOpportunities,
  };
}
