import {
  createSensaPortableLightweightPackage,
  readSensaPortableLightweightPackage,
} from '@sensa/content-validator/portable-lightweight';
import {
  createSensaPortableBook,
  portableBookMemberKey,
  readSensaPortableBook,
} from '@sensa/content-validator/portable-book';
import {
  sensaPortableBookDescriptorSchema,
  sensaPortableBookManifestSchema,
  type SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {sha256,stableUuid} from '@sensa/learning-kernel';

export type PortablePackageFixtureOptions=Readonly<{
  baseUrl?:string;
  packageId?:string;
  version?:number;
  targetLanguage?:string;
  supportLanguage?:string;
  expression?:string;
  expressionKind?:SensaPortableLightweightPackage['targetExpression']['expressionKind'];
  meaning?:string;
  scene?:string;
  senseId?:string;
  title?:string;
  createdAt?:string;
  semanticDeclaration?:SensaPortableLightweightPackage['semanticDeclaration'];
}>;

export type PortableBookDeliveryFixtureOptions=PortablePackageFixtureOptions&Readonly<{
  memberExpressions?:readonly string[];
}>;

/** Deterministic, provider-free `.sensa` fixture for Web and Cloud tests. */
export const portablePackageFixture=(options:PortablePackageFixtureOptions={})=>{
  const packageId=options.packageId??stableUuid('sensa:test-portable-package');
  const expression=options.expression??'borrow';
  const targetLanguage=options.targetLanguage??'en';
  const supportLanguage=options.supportLanguage??'zh-CN';
  const meaning=options.meaning??'临时取得他人的物品，并预期归还。';
  const expressionKind=options.expressionKind??'word';
  const expressionType=expressionKind==='utterance'
    ?'utterance_strategy' as const
    :expressionKind==='unspecified'
      ?'word' as const
      :expressionKind;
  const audioBytes=new TextEncoder().encode(`ID3:sensa-fixture:${expression}:${targetLanguage}`);
  const mediaId='pronunciation';
  const semanticDeclaration=options.semanticDeclaration??{
    contractVersion:'sensa-portable-semantic-declaration-v1' as const,
    sense:{
      senseId:stableUuid(`sensa:test-sense:${options.senseId??expression}`),
      senseVersionId:stableUuid(`sensa:test-sense-version:${options.senseId??expression}`),
      senseKey:`fixture:${options.senseId??expression}`,
      versionNumber:1,
      semanticPolicyVersion:'sensa-test-semantic-v1',
      semanticSpec:{
        schemaVersion:'sensa-sense-semantic-spec-v1' as const,
        coreMeaningFocus:meaning,
        prototypeScenes:[{
          summary:options.scene??'下雨时向同事借一把伞，并约好第二天归还。',
          participantRoles:[],
          states:[],
          directionOrCausality:null,
        }],
        includedCases:[],
        excludedCases:[],
        neighborContrasts:[],
        openQuestions:[],
      },
    },
    expression:{
      expressionId:stableUuid(`sensa:test-expression:${targetLanguage}:${expression}`),
      expressionVersionId:stableUuid(`sensa:test-expression-version:${targetLanguage}:${expression}`),
      versionNumber:1,
      expressionType,
      structure:{},
    },
    binding:{
      senseExpressionBindingId:stableUuid(`sensa:test-binding:${options.senseId??expression}:${targetLanguage}:${expression}`),
      bindingVersionId:stableUuid(`sensa:test-binding-version:${options.senseId??expression}:${targetLanguage}:${expression}`),
      versionNumber:1,
      relation:'realizes' as const,
      semanticCoverage:'exact' as const,
      registerLabel:null,
      usageConstraints:[],
    },
  };
  const manifest:SensaPortableLightweightPackage={
    format:'sensa-portable-lightweight-package-v2',
    metadata:{
      packageId,
      version:options.version??1,
      title:options.title??`${expression} fixture`,
      description:'Deterministic Portable Package fixture.',
      createdAt:options.createdAt??'2026-09-25T00:00:00Z',
      author:{name:'Sensa test fixture'},
      license:{name:'CC0'},
    },
    route:{targetLanguage,supportLanguage},
    sense:{senseId:options.senseId??`fixture:${expression}`,meaning},
    targetExpression:{text:expression,expressionKind},
    resources:{
      experienceRecallCue:{
        text:options.scene??'下雨时，你向同事借了一把伞，并约好第二天归还。',
        senseFocus:meaning,
      },
      senseConfirmation:{text:meaning},
      pronunciation:{
        surface:expression,
        audioMediaId:mediaId,
        method:'recording',
        source:'Synthetic fixture recording',
      },
      sceneBridge:{text:'把刚才的经验放进下面这句话。'},
      sceneRealization:{
        example:expression,
        translation:meaning,
        targetStart:0,
        targetEnd:expression.length,
      },
      optional:{},
    },
    media:[{
      mediaId,
      kind:'audio',
      mimeType:'audio/mpeg',
      sha256:sha256(audioBytes),
      sizeBytes:audioBytes.byteLength,
    }],
    semanticDeclaration,
  };
  const bytes=createSensaPortableLightweightPackage(
    manifest,
    new Map([[mediaId,audioBytes]]),
  );
  return {...readSensaPortableLightweightPackage(bytes),bytes};
};

export const portableBookDeliveryFixture=(options:PortableBookDeliveryFixtureOptions={})=>{
  const {memberExpressions,...packageOptions}=options;
  const expressions=memberExpressions?.length?memberExpressions:[packageOptions.expression??'borrow'];
  const rootPackageId=packageOptions.packageId??stableUuid('sensa:test-portable-package');
  const archives=expressions.map((expression,index)=>portablePackageFixture(memberExpressions?{
    ...packageOptions,
    packageId:stableUuid(`${rootPackageId}:book-member:${index}:${expression}`),
    senseId:`${packageOptions.senseId??'fixture'}:${index}:${expression}`,
    expression,
    title:`${expression} fixture`,
  }:packageOptions));
  const archive=archives[0]!;
  const base=packageOptions.baseUrl??'https://content.fixture.invalid/';
  const publishedAt='2026-09-25T00:00:00Z';
  const publisher={namespace:'sensa.test',name:'Sensa test publisher'};
  const bookIdentity=memberExpressions?rootPackageId:archive.package.metadata.packageId;
  const book={
    bookId:stableUuid(`sensa:test-book:${bookIdentity}`),
    bookKey:`fixture-${bookIdentity}`,
    bookVersionId:stableUuid(`sensa:test-book-version:${bookIdentity}:${archive.package.metadata.version}`),
    versionNumber:archive.package.metadata.version,
    title:packageOptions.title??archive.package.metadata.title,
    description:archive.package.metadata.description,
  };
  const contentRelease={
    contentReleaseId:stableUuid(`sensa:test-release:${bookIdentity}:${archive.package.metadata.version}`),
    versionNumber:archive.package.metadata.version,
    schemaVersion:'sensa-portable-lightweight-package-v2',
  };
  const manifest=sensaPortableBookManifestSchema.parse({
    format:'sensa-portable-book-v1',
    publisher,
    book,
    contentRelease,
    route:archive.package.route,
    publishedAt,
    changeSummary:'Synthetic test publication.',
    semanticAttestation:{
      kind:'publisher-attestation',
      publisherNamespace:publisher.namespace,
      subject:'member-semantic-declarations',
    },
    members:archives.map(member=>({
      packageId:member.package.metadata.packageId,
      version:member.package.metadata.version,
    })),
  });
  const bookBytes=createSensaPortableBook(
    manifest,
    new Map(manifest.members.map((member,index)=>[
      portableBookMemberKey(member),
      archives[index]!.bytes,
    ])),
  );
  const bookArchive=readSensaPortableBook(bookBytes);
  const bookUrl=new URL(`${bookArchive.archiveDigest}.sensa-book`,base).href;
  const descriptor=sensaPortableBookDescriptorSchema.parse({
    format:'sensa-portable-book-descriptor-v1',
    publisher,
    book,
    contentRelease,
    route:manifest.route,
    publishedAt,
    changeSummary:manifest.changeSummary,
    memberCount:manifest.members.length,
    byteLength:bookBytes.byteLength,
    sha256:bookArchive.archiveDigest,
    url:bookUrl,
  });
  return {
    ...archive,
    descriptor,
    manifest,
    bookBytes,
    bookArchive,
    responses:new Map<string,Uint8Array>([
      [bookUrl,bookBytes],
    ]),
  };
};
