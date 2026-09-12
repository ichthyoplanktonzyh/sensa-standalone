import {z} from 'zod';

/**
 * The languages Sensa can carry, and the learner's standing choice among them.
 *
 * Three language axes stay independent and must never be collapsed:
 *
 * - the interface language (`sensaInterfaceLanguages`), which decides the copy a
 *   learner reads and nothing about content;
 * - the familiar language, which is the language the learner already thinks in
 *   and writes personal expressions with;
 * - the target languages, which are the languages learned expressions belong to.
 *
 * One learner has exactly one familiar language and any number of target
 * languages; every expression anchor, learning target and content release names
 * one of them explicitly instead of assuming a fixed pair.
 */

export const sensaInterfaceLanguages = ['zh-CN', 'en'] as const;
export type SensaInterfaceLanguage = typeof sensaInterfaceLanguages[number];
export const sensaInterfaceLanguageSchema = z.enum(sensaInterfaceLanguages);

/** Which side of a learner's own language boundary an expression sits on. */
export const sensaLanguageRoleSchema = z.enum(['familiar', 'target']);
export type SensaLanguageRole = z.infer<typeof sensaLanguageRoleSchema>;

export type SensaLanguage = {
  /** BCP-47 primary tag. This is the tag stored on every expression anchor and
   * every learning target, so it never carries a regional variant the content
   * pipeline cannot produce. */
  readonly tag: string;
  /** Name in the language itself, shown beside the interface-language name so a
   * learner recognises their own language before reading a translation of it. */
  readonly endonym: string;
  /** Name per interface language. A language name is product copy, but the list
   * of languages is product data; keeping both here stops the Web application
   * and the extension from each inventing their own table. */
  readonly names: Readonly<Record<SensaInterfaceLanguage, string>>;
  readonly script: string;
  readonly direction: 'ltr' | 'rtl';
  /** Locale the browser speech synthesizer is asked for. It is deliberately not
   * derived from `tag`: synthesizers match on installed locale, so `en` alone
   * finds no voice on most systems. */
  readonly speechLocale: string;
  /** Wiktionary language group that defines this language's words. One edition
   * carries every language, so a target language is a group lookup and never a
   * separate host. */
  readonly wiktionaryCode: string;
  /** Whether the current release carries pronunciation evidence for this
   * language. Absent evidence is shown as absent, never guessed or synthesized
   * from spelling. */
  readonly ipa: boolean;
  /** Whether the learner may choose this language as a target language. Every
   * listed language can be chosen as a familiar language. */
  readonly asTarget: boolean;
};

/** All listed languages are defined by the English Wiktionary edition; its
 * per-language groups are what make a non-English target language reachable
 * without a second dictionary provider. */
export const sensaLexiconEdition = 'en' as const;

/** Copy that silently assumes an English target language is a defect, so the
 * languages the product actually carries are enumerated here rather than
 * inferred from a request. */
export const sensaLanguages: readonly SensaLanguage[] = [
  {tag:'zh-CN', endonym:'中文（简体）', names:{'zh-CN':'中文（简体）', en:'Chinese (Simplified)'}, script:'Hans', direction:'ltr', speechLocale:'zh-CN', wiktionaryCode:'zh', ipa:false, asTarget:false},
  {tag:'en', endonym:'English', names:{'zh-CN':'英语', en:'English'}, script:'Latn', direction:'ltr', speechLocale:'en-US', wiktionaryCode:'en', ipa:true, asTarget:true},
  {tag:'ja', endonym:'日本語', names:{'zh-CN':'日语', en:'Japanese'}, script:'Jpan', direction:'ltr', speechLocale:'ja-JP', wiktionaryCode:'ja', ipa:false, asTarget:true},
  {tag:'ko', endonym:'한국어', names:{'zh-CN':'韩语', en:'Korean'}, script:'Kore', direction:'ltr', speechLocale:'ko-KR', wiktionaryCode:'ko', ipa:false, asTarget:true},
  {tag:'es', endonym:'Español', names:{'zh-CN':'西班牙语', en:'Spanish'}, script:'Latn', direction:'ltr', speechLocale:'es-ES', wiktionaryCode:'es', ipa:false, asTarget:true},
  {tag:'fr', endonym:'Français', names:{'zh-CN':'法语', en:'French'}, script:'Latn', direction:'ltr', speechLocale:'fr-FR', wiktionaryCode:'fr', ipa:false, asTarget:true},
  {tag:'de', endonym:'Deutsch', names:{'zh-CN':'德语', en:'German'}, script:'Latn', direction:'ltr', speechLocale:'de-DE', wiktionaryCode:'de', ipa:false, asTarget:true},
  {tag:'ru', endonym:'Русский', names:{'zh-CN':'俄语', en:'Russian'}, script:'Cyrl', direction:'ltr', speechLocale:'ru-RU', wiktionaryCode:'ru', ipa:false, asTarget:true},
  {tag:'it', endonym:'Italiano', names:{'zh-CN':'意大利语', en:'Italian'}, script:'Latn', direction:'ltr', speechLocale:'it-IT', wiktionaryCode:'it', ipa:false, asTarget:true},
  {tag:'pt', endonym:'Português', names:{'zh-CN':'葡萄牙语', en:'Portuguese'}, script:'Latn', direction:'ltr', speechLocale:'pt-BR', wiktionaryCode:'pt', ipa:false, asTarget:true},
  {tag:'ar', endonym:'العربية', names:{'zh-CN':'阿拉伯语', en:'Arabic'}, script:'Arab', direction:'rtl', speechLocale:'ar-SA', wiktionaryCode:'ar', ipa:false, asTarget:true},
  {tag:'hi', endonym:'हिन्दी', names:{'zh-CN':'印地语', en:'Hindi'}, script:'Deva', direction:'ltr', speechLocale:'hi-IN', wiktionaryCode:'hi', ipa:false, asTarget:true},
  {tag:'th', endonym:'ไทย', names:{'zh-CN':'泰语', en:'Thai'}, script:'Thai', direction:'ltr', speechLocale:'th-TH', wiktionaryCode:'th', ipa:false, asTarget:true},
  {tag:'vi', endonym:'Tiếng Việt', names:{'zh-CN':'越南语', en:'Vietnamese'}, script:'Latn', direction:'ltr', speechLocale:'vi-VN', wiktionaryCode:'vi', ipa:false, asTarget:true},
  {tag:'id', endonym:'Bahasa Indonesia', names:{'zh-CN':'印尼语', en:'Indonesian'}, script:'Latn', direction:'ltr', speechLocale:'id-ID', wiktionaryCode:'id', ipa:false, asTarget:true},
  {tag:'tr', endonym:'Türkçe', names:{'zh-CN':'土耳其语', en:'Turkish'}, script:'Latn', direction:'ltr', speechLocale:'tr-TR', wiktionaryCode:'tr', ipa:false, asTarget:true},
  {tag:'nl', endonym:'Nederlands', names:{'zh-CN':'荷兰语', en:'Dutch'}, script:'Latn', direction:'ltr', speechLocale:'nl-NL', wiktionaryCode:'nl', ipa:false, asTarget:true},
  {tag:'pl', endonym:'Polski', names:{'zh-CN':'波兰语', en:'Polish'}, script:'Latn', direction:'ltr', speechLocale:'pl-PL', wiktionaryCode:'pl', ipa:false, asTarget:true},
];

export function sensaLanguage(tag: string): SensaLanguage | undefined {
  return sensaLanguages.find(language => language.tag === tag);
}

export function sensaLanguageForRole(role: SensaLanguageRole): readonly SensaLanguage[] {
  return role === 'target' ? sensaLanguages.filter(language => language.asTarget) : sensaLanguages;
}

/** An unknown tag is named by itself rather than hidden: the learner's stored
 * data outlives the release catalog that produced it. */
export function sensaLanguageDisplayName(tag: string, interfaceLanguage: SensaInterfaceLanguage): string {
  const language = sensaLanguage(tag);
  if (!language) return tag;
  return interfaceLanguage === 'zh-CN' ? language.names['zh-CN'] : language.names.en;
}

/** Every expression the learner reads back is explained in their familiar
 * language, so the reviewed access-path locale follows the familiar language
 * instead of the interface language. */
export function sensaLearnerLocale(familiarLanguageTag: string): string {
  return familiarLanguageTag;
}

/**
 * One familiar language and the target languages being learned.
 *
 * `activeTargetLanguageTag` is the language the action surfaces act on — today's
 * queue, a learning run, a daily limit — while read surfaces still show every
 * target language. Choosing a second target language therefore never changes the
 * meaning of an existing count; it only adds a surface the learner can switch to.
 *
 * The stored shape is deliberately not an enum of the catalog: a profile written
 * before the catalog changed must stay readable, and `resolveLanguageProfile`
 * drops what it cannot place instead of discarding the rest.
 */
export const sensaLanguageProfileSchema = z
  .object({
    familiarLanguageTag: z.string().trim().min(1).max(35),
    targetLanguageTags: z.array(z.string().trim().min(1).max(35)).min(1).max(8),
    activeTargetLanguageTag: z.string().trim().min(1).max(35),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.familiarLanguageTag === value.activeTargetLanguageTag) {
      context.addIssue({code:'custom', message:'a language cannot be both familiar and the active target language'});
    }
    if (new Set(value.targetLanguageTags).size !== value.targetLanguageTags.length) {
      context.addIssue({code:'custom', message:'target languages must be distinct'});
    }
    if (!value.targetLanguageTags.includes(value.activeTargetLanguageTag)) {
      context.addIssue({code:'custom', message:'the active target language must be one of the target languages'});
    }
    if (value.targetLanguageTags.includes(value.familiarLanguageTag)) {
      context.addIssue({code:'custom', message:'the familiar language must not also be a target language'});
    }
  });
export type SensaLanguageProfile = z.infer<typeof sensaLanguageProfileSchema>;

/** The pair the product has always shipped: a Chinese-speaking learner of
 * English. Nothing is migrated onto it; it is only what a library with no saved
 * profile yet is read as. */
export const defaultSensaLanguageProfile: SensaLanguageProfile = {
  familiarLanguageTag: 'zh-CN',
  targetLanguageTags: ['en'],
  activeTargetLanguageTag: 'en',
};

/** Drops tags this release no longer carries, then repairs the parts that depend
 * on them, and answers the default only when nothing placeable remains.
 *
 * The schema deliberately accepts any tag, because a profile written by an
 * earlier release is still a profile; placing a tag against the catalog is this
 * function's job, so a retired language costs the learner that language instead
 * of the whole profile. */
export function resolveLanguageProfile(raw: unknown): SensaLanguageProfile {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const placeable = (value: unknown): value is string => typeof value === 'string' && sensaLanguage(value) !== undefined;
  const familiarLanguageTag = placeable(record.familiarLanguageTag) ? record.familiarLanguageTag : defaultSensaLanguageProfile.familiarLanguageTag;
  const stored = Array.isArray(record.targetLanguageTags) ? record.targetLanguageTags.filter(placeable).filter(tag => sensaLanguage(tag)?.asTarget === true) : [];
  /** Deduplicated, excluding the familiar language, and bounded here rather than
   * only in the schema so the returned value always parses. */
  const targetLanguageTags = [...new Set(stored)].filter(tag => tag !== familiarLanguageTag).slice(0, 8);
  if (targetLanguageTags.length === 0) return defaultSensaLanguageProfile;
  const activeTargetLanguageTag = placeable(record.activeTargetLanguageTag) && targetLanguageTags.includes(record.activeTargetLanguageTag)
    ? record.activeTargetLanguageTag
    : targetLanguageTags[0]!;
  return {familiarLanguageTag, targetLanguageTags, activeTargetLanguageTag};
}
