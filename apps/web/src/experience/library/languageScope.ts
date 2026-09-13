/**
 * Which language a reading surface is showing.
 *
 * A read surface defaults to the learner's active target language, but a
 * learner's own material is not filed under one language: the same sense can be
 * connected to an English expression and to a Spanish one, and a library can
 * hold records from both. Two rules follow from that, and they are the reason
 * this is one module instead of a condition inside each screen:
 *
 * - a scope never hides the languages that are actually present, because a world
 *   read as empty looks exactly like data loss;
 * - counts in different languages are never added together, because the sum
 *   describes the learning of neither language.
 */

/** The languages a set of language-tagged things contains, deduplicated and
 * sorted. An untagged thing contributes nothing: it is read as the shipped pair
 * by whoever owns it, not invented here. */
export function languagesPresent(tags: Iterable<string | undefined>): string[] {
  const present = new Set<string>();
  for (const tag of tags) if (tag) present.add(tag);
  return [...present].sort();
}

/** The scope a surface reads in: the learner's own choice when they made one,
 * otherwise their active target language while it is present, otherwise every
 * language. The last step is what keeps a world that holds none of the active
 * language from reading as empty. */
export function resolveLanguageScope(
  choice: string | null,
  present: readonly string[],
  activeLanguageTag: string,
): string {
  if (choice) return choice;
  return present.includes(activeLanguageTag) ? activeLanguageTag : 'all';
}

/** Whether one tag falls inside a scope. `'all'` is the cross-language scope and
 * matches everything; an untagged thing belongs to no single language. */
export function inLanguageScope(tag: string | undefined, scope: string): boolean {
  if (scope === 'all') return true;
  return tag === scope;
}

/** The languages one meaning's connected expressions are written in. A meaning
 * answers with every language it contains, so the same sense connected to two
 * languages is reachable from both instead of being filed under one. */
export function meaningLanguageTags(bindings: readonly { languageTag: string }[]): string[] {
  return [...new Set(bindings.map((binding) => binding.languageTag))].sort();
}
