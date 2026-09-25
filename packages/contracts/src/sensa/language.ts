import {z} from 'zod';

/**
 * Languages are facts; the part they play is contextual.
 *
 * Interface Locale only chooses product copy. A Language Learning Route assigns
 * Target and Support roles. A concrete transformation may additionally assign
 * Input and Output roles. None of those roles is an intrinsic property of a
 * learner or a language, and Target and Support may name the same language.
 */

export const sensaInterfaceLocales = ['zh-CN', 'en'] as const;
export type SensaInterfaceLocale = typeof sensaInterfaceLocales[number];
export const sensaInterfaceLocaleSchema = z.enum(sensaInterfaceLocales);

/** A role a language plays in one route or operation, never a learner trait. */
export const sensaLanguageRoleSchema = z.enum(['target', 'support', 'input', 'output']);
export type SensaLanguageRole = z.infer<typeof sensaLanguageRoleSchema>;

/**
 * Any BCP-47-shaped tag, without placing it against the catalog.
 *
 * Deliberately not an enum of `sensaLanguages`: a tag written by an earlier
 * release, or detected on a page in a language this release does not curate, is
 * still the learner's own material. Placing the tag against the catalog is the
 * caller's job, so an unplaced language costs the learner that language instead
 * of the whole capture.
 */
export function sensaCanonicalLanguageTag(value:string):string|null {
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}

/** A canonical BCP-47 Language Tag. Canonical spelling prevents two identities
 * such as `en-us` and `en-US` while preserving meaningful variants. */
export const sensaLanguageTagSchema = z.string().trim().min(1).max(35).superRefine((tag,context)=>{
  if(sensaCanonicalLanguageTag(tag)!==tag)context.addIssue({code:'custom',message:'language tag must be canonical BCP-47'});
});

export type SensaLanguage = {
  /** BCP-47 primary tag. This is the tag stored on every expression anchor and
   * every learning target, so it never carries a regional variant the content
   * pipeline cannot produce. */
  readonly tag: string;
  /** ISO 639-3 code, the vocabulary language detectors answer in.
   *
   * Detection runs in the extension, before any library is reachable, and only
   * the catalog can say which of the tags above a detected code means — the
   * same reason `wiktionaryCode` lives here. Two languages may share a script
   * and still need different codes; a code with no entry is a language this
   * release cannot name, and is reported as undetermined rather than guessed. */
  readonly iso6393: string;
  /** Name in the language itself, shown beside the interface-language name so a
   * learner recognises their own language before reading a translation of it. */
  readonly endonym: string;
  /** Name per interface language. A language name is product copy, but the list
   * of languages is product data; keeping both here stops the Web application
   * and the extension from each inventing their own table. */
  readonly names: Readonly<Record<SensaInterfaceLocale, string>>;
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
  /** Whether the curated release carries pronunciation evidence for this
   * language, which today means English only.
   *
   * It does not gate what a learner is shown. A live lookup displays the
   * pronunciation the provider actually returned for that word, in any
   * language; absent evidence is shown as absent, never guessed or synthesized
   * from spelling. */
  readonly ipa: boolean;
  /** Whether the learner may choose this language as a Target Language. Every
   * listed language can be chosen as a Support Language. */
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
  {tag:'zh-CN', iso6393:'cmn', endonym:'中文（简体）', names:{'zh-CN':'中文（简体）', en:'Chinese (Simplified)'}, script:'Hans', direction:'ltr', speechLocale:'zh-CN', wiktionaryCode:'zh', ipa:false, asTarget:true},
  {tag:'en', iso6393:'eng', endonym:'English', names:{'zh-CN':'英语', en:'English'}, script:'Latn', direction:'ltr', speechLocale:'en-US', wiktionaryCode:'en', ipa:true, asTarget:true},
  {tag:'ja', iso6393:'jpn', endonym:'日本語', names:{'zh-CN':'日语', en:'Japanese'}, script:'Jpan', direction:'ltr', speechLocale:'ja-JP', wiktionaryCode:'ja', ipa:false, asTarget:true},
  {tag:'ko', iso6393:'kor', endonym:'한국어', names:{'zh-CN':'韩语', en:'Korean'}, script:'Kore', direction:'ltr', speechLocale:'ko-KR', wiktionaryCode:'ko', ipa:false, asTarget:true},
  {tag:'es', iso6393:'spa', endonym:'Español', names:{'zh-CN':'西班牙语', en:'Spanish'}, script:'Latn', direction:'ltr', speechLocale:'es-ES', wiktionaryCode:'es', ipa:false, asTarget:true},
  {tag:'fr', iso6393:'fra', endonym:'Français', names:{'zh-CN':'法语', en:'French'}, script:'Latn', direction:'ltr', speechLocale:'fr-FR', wiktionaryCode:'fr', ipa:false, asTarget:true},
  {tag:'de', iso6393:'deu', endonym:'Deutsch', names:{'zh-CN':'德语', en:'German'}, script:'Latn', direction:'ltr', speechLocale:'de-DE', wiktionaryCode:'de', ipa:false, asTarget:true},
  {tag:'ru', iso6393:'rus', endonym:'Русский', names:{'zh-CN':'俄语', en:'Russian'}, script:'Cyrl', direction:'ltr', speechLocale:'ru-RU', wiktionaryCode:'ru', ipa:false, asTarget:true},
  {tag:'it', iso6393:'ita', endonym:'Italiano', names:{'zh-CN':'意大利语', en:'Italian'}, script:'Latn', direction:'ltr', speechLocale:'it-IT', wiktionaryCode:'it', ipa:false, asTarget:true},
  {tag:'pt', iso6393:'por', endonym:'Português', names:{'zh-CN':'葡萄牙语', en:'Portuguese'}, script:'Latn', direction:'ltr', speechLocale:'pt-BR', wiktionaryCode:'pt', ipa:false, asTarget:true},
  {tag:'ar', iso6393:'arb', endonym:'العربية', names:{'zh-CN':'阿拉伯语', en:'Arabic'}, script:'Arab', direction:'rtl', speechLocale:'ar-SA', wiktionaryCode:'ar', ipa:false, asTarget:true},
  {tag:'hi', iso6393:'hin', endonym:'हिन्दी', names:{'zh-CN':'印地语', en:'Hindi'}, script:'Deva', direction:'ltr', speechLocale:'hi-IN', wiktionaryCode:'hi', ipa:false, asTarget:true},
  {tag:'th', iso6393:'tha', endonym:'ไทย', names:{'zh-CN':'泰语', en:'Thai'}, script:'Thai', direction:'ltr', speechLocale:'th-TH', wiktionaryCode:'th', ipa:false, asTarget:true},
  {tag:'vi', iso6393:'vie', endonym:'Tiếng Việt', names:{'zh-CN':'越南语', en:'Vietnamese'}, script:'Latn', direction:'ltr', speechLocale:'vi-VN', wiktionaryCode:'vi', ipa:false, asTarget:true},
  {tag:'id', iso6393:'ind', endonym:'Bahasa Indonesia', names:{'zh-CN':'印尼语', en:'Indonesian'}, script:'Latn', direction:'ltr', speechLocale:'id-ID', wiktionaryCode:'id', ipa:false, asTarget:true},
  {tag:'tr', iso6393:'tur', endonym:'Türkçe', names:{'zh-CN':'土耳其语', en:'Turkish'}, script:'Latn', direction:'ltr', speechLocale:'tr-TR', wiktionaryCode:'tr', ipa:false, asTarget:true},
  {tag:'nl', iso6393:'nld', endonym:'Nederlands', names:{'zh-CN':'荷兰语', en:'Dutch'}, script:'Latn', direction:'ltr', speechLocale:'nl-NL', wiktionaryCode:'nl', ipa:false, asTarget:true},
  {tag:'pl', iso6393:'pol', endonym:'Polski', names:{'zh-CN':'波兰语', en:'Polish'}, script:'Latn', direction:'ltr', speechLocale:'pl-PL', wiktionaryCode:'pl', ipa:false, asTarget:true},
];

/** The catalog entry a language detector's answer names, or nothing when this
 * release cannot place that code. Detection never invents a tag: an unplaceable
 * answer is undetermined, which the caller reports as such. */
export function sensaLanguageForIso6393(code: string): SensaLanguage | undefined {
  return sensaLanguages.find(language => language.iso6393 === code);
}

/**
 * The catalog entry a declared tag names — a page's `lang` attribute, a subtitle
 * track's code — or nothing when this release cannot place it.
 *
 * A declaration carries subtags the catalog does not: `en-US` is the English
 * entry and `zh-Hans` is Simplified Chinese, so an exact tag is tried first and
 * the primary subtag second. Traditional Chinese is kept undetermined because
 * the catalog only has Simplified Chinese. `pt-PT` places on Portuguese because
 * the catalog carries Portuguese, while `yue` places on nothing.
 */
export function sensaLanguageForDeclaredTag(tag: string): SensaLanguage | undefined {
  const canonical=sensaCanonicalLanguageTag(tag);
  if(!canonical)return undefined;
  const normalized = canonical.toLowerCase();
  const exact = sensaLanguages.find(language => language.tag.toLowerCase() === normalized);
  if (exact) return exact;
  const subtags = normalized.split('-');
  if (subtags[0] === 'zh' && subtags.some(subtag => ['hant', 'tw', 'hk', 'mo'].includes(subtag))) return undefined;
  const primary = subtags[0]!;
  return sensaLanguages.find(language => language.tag.toLowerCase().split('-')[0] === primary);
}

export function sensaLanguage(tag: string): SensaLanguage | undefined {
  return sensaLanguages.find(language => language.tag === tag);
}

/**
 * A capability never answers a request by changing the requested Language Tag.
 * `effectiveLanguageTag` only names the implementation resource that will be
 * used. Callers continue to persist and display `requestedLanguageTag`.
 */
export const sensaLanguageSupportResolutionSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('exact'),requestedLanguageTag:sensaLanguageTagSchema,effectiveLanguageTag:sensaLanguageTagSchema}).strict(),
  z.object({status:z.literal('fallback'),requestedLanguageTag:sensaLanguageTagSchema,effectiveLanguageTag:sensaLanguageTagSchema}).strict(),
  z.object({status:z.literal('unavailable'),requestedLanguageTag:sensaLanguageTagSchema,effectiveLanguageTag:z.null()}).strict(),
]);
export type SensaLanguageSupportResolution=z.infer<typeof sensaLanguageSupportResolutionSchema>;

/**
 * Resolve one requested tag against the exact resources an adapter carries.
 * A primary-language resource may be used as an explicit fallback for a more
 * specific tag, but never for another primary language.
 */
export function sensaResolveLanguageSupport(
  requestedLanguageTag:string,
  supportedLanguageTags:readonly string[]=sensaLanguages.map(language=>language.tag),
):SensaLanguageSupportResolution {
  const requested=sensaLanguageTagSchema.parse(requestedLanguageTag);
  const supported=supportedLanguageTags.map(tag=>sensaLanguageTagSchema.parse(tag));
  if(supported.includes(requested))return {status:'exact',requestedLanguageTag:requested,effectiveLanguageTag:requested};
  const requestedPrimary=requested.split('-')[0]!.toLowerCase();
  const fallback=supported.find(tag=>tag.split('-')[0]!.toLowerCase()===requestedPrimary);
  return fallback
    ?{status:'fallback',requestedLanguageTag:requested,effectiveLanguageTag:fallback}
    :{status:'unavailable',requestedLanguageTag:requested,effectiveLanguageTag:null};
}

export function sensaLanguageForRole(role: SensaLanguageRole): readonly SensaLanguage[] {
  return role === 'target' ? sensaLanguages.filter(language => language.asTarget) : sensaLanguages;
}

/**
 * Which side of the operation's own language boundary a captured tag sits on,
 * or nothing when the tag is not part of that boundary at all.
 *
 * A capture says what language it is; this says what that means here. The two
 * are separate because only the library holds the profile, so a sender that
 * stamped a role would be choosing a side it cannot see. `null` is a real
 * answer — a learner reading a third language captures material that belongs to
 * neither side — and every caller must decide what to do with it rather than
 * receive a default.
 */
export function sensaLanguageRolesForTag(
  tag: string | null,
  languages: SensaPinnedLanguageContext,
): readonly SensaLanguageRole[] {
  if (!tag) return [];
  const roles:SensaLanguageRole[]=[];
  if (tag === languages.targetLanguageTag) roles.push('target');
  if (tag === languages.supportLanguageTag) roles.push('support');
  return roles;
}

/** An unknown tag is named by itself rather than hidden: the learner's stored
 * data outlives the release catalog that produced it. */
export function sensaLanguageDisplayName(tag: string, interfaceLocale: SensaInterfaceLocale): string {
  const language = sensaLanguageForDeclaredTag(tag);
  if (!language) return tag;
  return interfaceLocale === 'zh-CN' ? language.names['zh-CN'] : language.names.en;
}

/** Every expression the learner reads back is explained in its support
 * language, so the reviewed access-path locale follows the support language
 * instead of the interface language. */
export function sensaLearnerLocale(supportLanguageTag: string): string {
  return supportLanguageTag;
}

/**
 * The immutable language roles resolved for one operation or Session.
 *
 * Formal learning includes the Route id and revision. Pre-route semantic work
 * pins Target and Support without manufacturing a Route. Input and Output are
 * intentionally absent: they belong to a particular transformation inside the
 * operation, not to the Route itself.
 */
export interface SensaPinnedLanguageContext {
  targetLanguageTag: string;
  supportLanguageTag: string;
  languageRouteId?:string;
  languageRouteRevision?:number;
}

/** A formal-learning or active-surface context always identifies the exact
 * Route revision it was resolved from. */
export interface SensaFormalPinnedLanguageContext extends SensaPinnedLanguageContext {
  languageRouteId:string;
  languageRouteRevision:number;
}

/**
 * A tag this release can name, for any value about to enter a model prompt.
 *
 * Stricter than `sensaLanguageTagSchema` on purpose: a capture keeps a language
 * this release does not curate, because the material is the learner's either
 * way, but a request to run a model over it cannot — a prompt has to name the
 * language it is talking about, and a code passed through as itself is a
 * language no model was told about.
 */
export const sensaLanguageNameableTagSchema = sensaLanguageTagSchema.refine(
  tag => sensaLanguageForDeclaredTag(tag) !== undefined,
  { message: 'this release cannot name that language' },
);

/**
 * The pinned pair as it crosses a boundary.
 *
 * Both tags must be placeable in the current catalog. A captured observation
 * can preserve a tag this release cannot place, but an operation request cannot:
 * a model prompt must be able to name the languages it is talking about.
 */
export const sensaPinnedLanguageContextSchema = z
  .object({
    targetLanguageTag: sensaLanguageNameableTagSchema,
    supportLanguageTag: sensaLanguageNameableTagSchema,
    languageRouteId:z.string().uuid().optional(),
    languageRouteRevision:z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.languageRouteId===undefined)!==(value.languageRouteRevision===undefined)) {
      context.addIssue({ code: 'custom', message: 'a formal language context pins both route id and revision' });
    }
  })
  .transform(({languageRouteId,languageRouteRevision,...languages})=>({
    ...languages,
    ...(languageRouteId===undefined?{}:{languageRouteId,languageRouteRevision:languageRouteRevision!}),
  }));

export const sensaFormalPinnedLanguageContextSchema=z.object({
  targetLanguageTag:sensaLanguageNameableTagSchema,
  supportLanguageTag:sensaLanguageNameableTagSchema,
  languageRouteId:z.string().uuid(),
  languageRouteRevision:z.number().int().positive(),
}).strict();

/** What a language is called inside a model prompt, which is written in English
 * whatever the learner reads. A prompt names both languages of the pair rather
 * than describing a fixed one, so a model is never told the wrong pair. */
export function sensaLanguagePromptName(tag: string): string {
  return sensaLanguageForDeclaredTag(tag)?.names.en ?? tag;
}

export const sensaLanguageRouteStatusSchema=z.enum(['active','paused','archived']);
export type SensaLanguageRouteStatus=z.infer<typeof sensaLanguageRouteStatusSchema>;

/** A learner-owned direction of formal study. Its Study Plan is route-scoped in
 * the Curriculum module; this contract owns only the route identity and roles. */
export const sensaLanguageLearningRouteSchema=z.object({
  id:z.string().uuid(),
  revision:z.number().int().positive(),
  targetLanguageTag:sensaLanguageNameableTagSchema,
  defaultSupportLanguageTag:sensaLanguageNameableTagSchema,
  status:sensaLanguageRouteStatusSchema,
}).strict();
export type SensaLanguageLearningRoute=z.infer<typeof sensaLanguageLearningRouteSchema>;

export const sensaLanguageRouteCollectionSchema=z.object({
  revision:z.number().int().positive(),
  routes:z.array(sensaLanguageLearningRouteSchema).min(1).max(16),
}).strict().superRefine((value,context)=>{
  if(new Set(value.routes.map(route=>route.id)).size!==value.routes.length){
    context.addIssue({code:'custom',message:'language route ids must be distinct'});
  }
  if(!value.routes.some(route=>route.status==='active')){
    context.addIssue({code:'custom',message:'at least one language route must be active'});
  }
});
export type SensaLanguageRouteCollection=z.infer<typeof sensaLanguageRouteCollectionSchema>;

/** Active Route Selection is device/surface preference, not learner progress. */
export const sensaActiveRouteSelectionSchema=z.object({
  surface:z.string().trim().min(1).max(64),
  languageRouteId:z.string().uuid(),
}).strict();
export type SensaActiveRouteSelection=z.infer<typeof sensaActiveRouteSelectionSchema>;

export const defaultSensaLanguageRoute:SensaLanguageLearningRoute={
  id:'00000000-0000-4000-8000-000000000001',
  revision:1,
  targetLanguageTag:'en',
  defaultSupportLanguageTag:'zh-CN',
  status:'active',
};

export const defaultSensaLanguageRouteCollection:SensaLanguageRouteCollection={
  revision:1,
  routes:[defaultSensaLanguageRoute],
};

export function sensaPinnedLanguageContext(route:SensaLanguageLearningRoute):SensaFormalPinnedLanguageContext {
  return sensaFormalPinnedLanguageContextSchema.parse({
    targetLanguageTag:route.targetLanguageTag,
    supportLanguageTag:route.defaultSupportLanguageTag,
    languageRouteId:route.id,
    languageRouteRevision:route.revision,
  });
}
