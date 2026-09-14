import {z} from 'zod';
import {sensaRuntimeLearningReleaseSchema} from '../runtimeLearningRelease.js';
import {sensaLightweightInitialMaterializationContentSchema} from '../lightweightLearningContent.js';
import {sensaLanguageTagSchema} from '../language.js';
import {sensaExpressionBindingRelationSchema,sensaExpressionTypeSchema,sensaSemanticCoverageSchema,sensaSenseSemanticSpecSchema} from '../semanticRegistry.js';

const id=z.string().uuid(),label=z.string().trim().min(1).max(500),digest=z.string().regex(/^[a-f0-9]{64}$/u),timestamp=z.string().datetime({offset:true});
const deliveryUrl=z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));});
export const maxPublishedBookReleaseBytes=50*1024*1024;
export const publishedLearningSemanticFactsSchema=z.object({
 senseKey:label,senseVersionNumber:z.number().int().positive(),semanticPolicyVersion:label,semanticSpec:sensaSenseSemanticSpecSchema,
 expressionId:id,expressionVersionId:id,expressionType:sensaExpressionTypeSchema,expressionVersionNumber:z.number().int().positive(),expressionStructure:z.record(z.string(),z.unknown()),
 bindingVersionNumber:z.number().int().positive(),relation:sensaExpressionBindingRelationSchema,semanticCoverage:sensaSemanticCoverageSchema,registerLabel:label.nullable(),usageConstraints:z.array(label),
}).strict();
const entryBase={senseId:id,senseVersionId:id,bindingId:id,bindingVersionId:id,expression:label,assurancePackageKey:label.optional(),meaning:z.string().trim().min(1).max(8000),content:sensaLightweightInitialMaterializationContentSchema};
const legacyEntrySchema=z.object(entryBase).strict();
export const bookReleaseEntrySchema=z.object({...entryBase,semantic:publishedLearningSemanticFactsSchema}).strict();
const assuranceSchema=z.object({release:sensaRuntimeLearningReleaseSchema,audio:z.record(z.string(),z.string().regex(/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+={0,2}$/u))}).strict().optional();
const uniqueTargets=(entries:ReadonlyArray<z.infer<typeof legacyEntrySchema>>,context:z.RefinementCtx)=>{
 const keys=entries.map(entry=>entry.senseVersionId+':'+entry.bindingVersionId);
 if(new Set(keys).size!==keys.length)context.addIssue({code:'custom',message:'Duplicate learning target'});
};

/**
 * Compatibility reader for the first Web delivery container. It grouped many
 * Sense Learning Packages under one misleading package identity. New releases
 * use bookReleaseBundleSchema; old installed bytes remain replayable.
 */
export const legacyLearningPackageSchema=z.object({
 format:z.literal('sensa-learning-package-v1'),id,version:label,title:label,
 targetLanguage:sensaLanguageTagSchema,supportLanguage:sensaLanguageTagSchema,
 assurance:assuranceSchema,entries:z.array(legacyEntrySchema).min(1).max(100),
}).strict().superRefine((bundle,context)=>uniqueTargets(bundle.entries,context));

/** One immutable learner-facing edition of a stable Book. The entries are
 * delivery snapshots of the Book Version's Sense Learning Packages, not the
 * identity of the Book or Content Release themselves. */
export const bookReleaseBundleSchema=z.object({
 format:z.literal('sensa-book-release-bundle-v1'),
 book:z.object({bookId:id,bookKey:label,bookVersionId:id,versionNumber:z.number().int().positive(),title:label,description:z.string().trim().max(2000)}).strict(),
 contentRelease:z.object({contentReleaseId:id,versionNumber:z.number().int().positive(),schemaVersion:label}).strict(),
 targetLanguage:sensaLanguageTagSchema,supportLanguage:sensaLanguageTagSchema,
 publishedAt:timestamp,changeSummary:z.string().trim().max(2000),
 assurance:assuranceSchema,entries:z.array(bookReleaseEntrySchema).min(1).max(1000),
}).strict().superRefine((bundle,context)=>uniqueTargets(bundle.entries,context));

export const learningPackageSchema=z.union([bookReleaseBundleSchema,legacyLearningPackageSchema]);

export const legacyLearningPackageDescriptorSchema=z.object({
 id,version:label,title:label,description:z.string().max(2000),entryCount:z.number().int().min(1).max(100),
 byteLength:z.number().int().min(1).max(8*1024*1024),sha256:digest,url:deliveryUrl,
}).strict();

export const bookReleaseDescriptorSchema=z.object({
 format:z.literal('sensa-book-release-descriptor-v1'),
 book:z.object({bookId:id,bookKey:label,bookVersionId:id,versionNumber:z.number().int().positive(),title:label,description:z.string().trim().max(2000)}).strict(),
 contentRelease:z.object({contentReleaseId:id,versionNumber:z.number().int().positive(),schemaVersion:label}).strict(),
 targetLanguage:sensaLanguageTagSchema,supportLanguage:sensaLanguageTagSchema,
 publishedAt:timestamp,changeSummary:z.string().trim().max(2000),
 entryCount:z.number().int().min(1).max(1000),byteLength:z.number().int().min(1).max(maxPublishedBookReleaseBytes),sha256:digest,url:deliveryUrl,
}).strict();

export const learningPackageDescriptorSchema=z.union([bookReleaseDescriptorSchema,legacyLearningPackageDescriptorSchema]);
export const legacyLearningPackageCatalogSchema=z.object({items:z.array(legacyLearningPackageDescriptorSchema).max(100)}).strict();

/** Immutable registry snapshots can be cached and addressed by revision. A
 * publication writes all release artifacts first and exposes this snapshot
 * last. The catalog may list several Books, but only one public version for a
 * Book and exact language pair is allowed in one snapshot. */
export const learningContentRegistrySchema=z.object({
 format:z.literal('sensa-learning-content-registry-v1'),revision:digest,publishedAt:timestamp,
 items:z.array(bookReleaseDescriptorSchema).max(1000),
}).strict().superRefine((registry,context)=>{
 const identities=registry.items.map(item=>[item.book.bookId,item.targetLanguage,item.supportLanguage].join(':'));
 if(new Set(identities).size!==identities.length)context.addIssue({code:'custom',message:'Duplicate public Book version for one language pair'});
});

/** Rolling deployments may briefly serve the first catalog shape. Consumers
 * read both, while every newly produced registry uses the explicit format. */
export const learningPackageCatalogSchema=z.union([learningContentRegistrySchema,legacyLearningPackageCatalogSchema]);

export type BookReleaseBundle=z.infer<typeof bookReleaseBundleSchema>;
export type BookReleaseEntry=z.infer<typeof bookReleaseEntrySchema>;
export type PublishedLearningSemanticFacts=z.infer<typeof publishedLearningSemanticFactsSchema>;
export type LearningPackageBundle=z.infer<typeof learningPackageSchema>;
export type BookReleaseDescriptor=z.infer<typeof bookReleaseDescriptorSchema>;
export type LearningPackageDescriptor=z.infer<typeof learningPackageDescriptorSchema>;
export type LearningContentRegistry=z.infer<typeof learningContentRegistrySchema>;

export const learningBundleBookId=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.book.bookId:bundle.id;
export const learningBundleBookVersionId=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.book.bookVersionId:null;
export const learningBundleVersionNumber=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.book.versionNumber:Number.parseInt(bundle.version,10)||1;
export const learningBundleVersionLabel=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?String(bundle.book.versionNumber):bundle.version;
export const learningBundleTitle=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.book.title:bundle.title;
export const learningBundleDescription=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.book.description:'';
export const learningBundleContentReleaseId=(bundle:LearningPackageBundle)=>bundle.format==='sensa-book-release-bundle-v1'?bundle.contentRelease.contentReleaseId:null;
export const learningDescriptorBookId=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?descriptor.book.bookId:descriptor.id;
export const learningDescriptorBookVersionId=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?descriptor.book.bookVersionId:null;
export const learningDescriptorVersionNumber=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?descriptor.book.versionNumber:Number.parseInt(descriptor.version,10)||1;
export const learningDescriptorVersionLabel=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?String(descriptor.book.versionNumber):descriptor.version;
export const learningDescriptorTitle=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?descriptor.book.title:descriptor.title;
export const learningDescriptorDescription=(descriptor:LearningPackageDescriptor)=>'format' in descriptor?descriptor.book.description:descriptor.description;
