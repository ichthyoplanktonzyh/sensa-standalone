import { sensaLanguageForRole } from "@sensa/contracts/sensa";

/** Human-authored target-language material for the live language-route matrix. */
export type LanguageTargetFixture = {
  readonly targetLanguageTag: string;
  /** The exact target-language occurrence the browser flow should select. */
  readonly expression: string;
  /** A natural sentence containing `expression` exactly once. */
  readonly sentence: string;
  /** English gloss used by a reviewer to disambiguate the intended sense. */
  readonly semanticBaselineEnglish: string;
  /** User-provided, browser-enterable context; it is not an acceptance fact. */
  readonly browserContext: string;
  /** Deterministic expectations for route and semantic-result assertions. */
  readonly expectedLabels: {
    readonly targetLanguageTag: string;
    readonly supportLanguageTag: string;
    readonly expression: string;
    readonly senseEnglish: string;
  };
};

export type LanguageMatrixCase = {
  readonly targetLanguageTag: string;
  readonly supportLanguageTag: string;
  readonly fixture: LanguageTargetFixture;
  readonly supportFixture: { readonly context: string; readonly clarification: string };
};

/** Learner-authored input for each Support Language. These are acceptance fixtures, not generated translations. */
export const languageSupportFixtures: Record<string, {context: string; clarification: string}> = {
  'zh-CN': {context:'我在家种罗勒。它需要水才能保持健康。',clarification:'我指的是罗勒根部吸收、维持健康的那种液体。'},
  en: {context:'I grow basil at home. It needs water to stay healthy.',clarification:'I mean the liquid its roots absorb to stay healthy.'},
  ja: {context:'家でバジルを育てています。元気に育つには水が必要です。',clarification:'根から吸って元気に育つために必要な液体のことです。'},
  ko: {context:'집에서 바질을 키우고 있어요. 건강하게 자라려면 물이 필요해요.',clarification:'바질이 뿌리로 흡수해 건강하게 자라는 데 필요한 액체를 뜻해요.'},
  es: {context:'Cultivo albahaca en casa. Necesita agua para mantenerse sana.',clarification:'Me refiero al líquido que absorbe por las raíces para mantenerse sana.'},
  fr: {context:'Je cultive du basilic chez moi. Il a besoin d’eau pour rester en bonne santé.',clarification:'Je parle du liquide qu’il absorbe par ses racines pour rester en bonne santé.'},
  de: {context:'Ich ziehe zu Hause Basilikum. Es braucht Wasser, um gesund zu bleiben.',clarification:'Ich meine die Flüssigkeit, die es über seine Wurzeln aufnimmt, um gesund zu bleiben.'},
  ru: {context:'Я выращиваю базилик дома. Ему нужна вода, чтобы оставаться здоровым.',clarification:'Я имею в виду жидкость, которую базилик впитывает корнями, чтобы оставаться здоровым.'},
  it: {context:'Coltivo basilico a casa. Ha bisogno d’acqua per restare sano.',clarification:'Intendo il liquido che assorbe attraverso le radici per restare sano.'},
  pt: {context:'Cultivo manjericão em casa. Ele precisa de água para se manter saudável.',clarification:'Refiro-me ao líquido que ele absorve pelas raízes para se manter saudável.'},
  ar: {context:'أزرع الريحان في المنزل. يحتاج إلى الماء ليبقى بصحة جيدة.',clarification:'أقصد السائل الذي يمتصه الريحان عبر جذوره ليبقى بصحة جيدة.'},
  hi: {context:'मेरे घर में तुलसी का पौधा है। उसे स्वस्थ रहने के लिए पानी चाहिए।',clarification:'मेरा मतलब उस तरल से है जिसे यह पौधा जड़ों से सोखता है ताकि स्वस्थ रहे।'},
  th: {context:'ฉันปลูกโหระพาที่บ้าน มันต้องการน้ำเพื่อให้เติบโตแข็งแรง',clarification:'ฉันหมายถึงของเหลวที่ต้นโหระพาดูดซึมทางรากเพื่อให้แข็งแรง'},
  vi: {context:'Tôi trồng húng quế ở nhà. Cây cần nước để phát triển khỏe mạnh.',clarification:'Ý tôi là chất lỏng mà cây hấp thụ qua rễ để phát triển khỏe mạnh.'},
  id: {context:'Saya menanam kemangi di rumah. Tanaman itu membutuhkan air agar tetap sehat.',clarification:'Maksud saya cairan yang diserap tanaman melalui akarnya agar tetap sehat.'},
  tr: {context:'Evde fesleğen yetiştiriyorum. Sağlıklı kalması için suya ihtiyacı var.',clarification:'Kökleriyle emerek sağlıklı kalmasını sağlayan sıvıyı kastediyorum.'},
  nl: {context:'Ik kweek thuis basilicum. De plant heeft water nodig om gezond te blijven.',clarification:'Ik bedoel de vloeistof die de plant via zijn wortels opneemt om gezond te blijven.'},
  pl: {context:'Uprawiam bazylię w domu. Potrzebuje wody, żeby pozostać zdrowa.',clarification:'Mam na myśli płyn, który bazylia pobiera przez korzenie, żeby zachować zdrowie.'},
};

const senseEnglish =
  "The clear liquid that basil absorbs through its roots and needs in order to stay healthy; not a lake, sea, or other body of water.";
const browserContext =
  "I keep basil on my kitchen windowsill. I check the soil before work, because the plant needs water to stay healthy.";

/** One natural, concrete, and lexically searchable expression for each target. */
export const languageTargetFixtures: readonly LanguageTargetFixture[] = [
  {
    targetLanguageTag: "en",
    expression: "Water",
    sentence: "Water is essential for the basil on my windowsill.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "en",
      supportLanguageTag: "",
      expression: "Water",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "ja",
    expression: "水",
    sentence: "バジルには水が必要です。",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "ja",
      supportLanguageTag: "",
      expression: "水",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "ko",
    expression: "물",
    sentence: "바질에는 물이 필요합니다.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "ko",
      supportLanguageTag: "",
      expression: "물",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "es",
    expression: "agua",
    sentence: "El agua es esencial para la albahaca de mi ventana.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "es",
      supportLanguageTag: "",
      expression: "agua",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "fr",
    expression: "eau",
    sentence: "L’eau est essentielle au basilic sur mon rebord de fenêtre.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "fr",
      supportLanguageTag: "",
      expression: "eau",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "de",
    expression: "Wasser",
    sentence:
      "Wasser ist für das Basilikum auf meiner Fensterbank unverzichtbar.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "de",
      supportLanguageTag: "",
      expression: "Wasser",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "ru",
    expression: "вода",
    sentence: "Для базилика на моем подоконнике вода необходима.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "ru",
      supportLanguageTag: "",
      expression: "вода",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "it",
    expression: "acqua",
    sentence: "L’acqua è essenziale per il basilico sul mio davanzale.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "it",
      supportLanguageTag: "",
      expression: "acqua",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "pt",
    expression: "água",
    sentence: "A água é essencial para o manjericão na minha janela.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "pt",
      supportLanguageTag: "",
      expression: "água",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "ar",
    expression: "ماء",
    sentence: "يحتاج الريحان إلى ماء لينمو بصحة جيدة.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "ar",
      supportLanguageTag: "",
      expression: "ماء",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "hi",
    expression: "पानी",
    sentence: "तुलसी के पौधे के लिए पानी ज़रूरी है।",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "hi",
      supportLanguageTag: "",
      expression: "पानी",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "th",
    expression: "น้ำ",
    sentence: "ต้นโหระพาต้องใช้น้ำเพื่อให้เติบโตแข็งแรง",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "th",
      supportLanguageTag: "",
      expression: "น้ำ",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "vi",
    expression: "nước",
    sentence: "Cây húng quế cần nước để phát triển khỏe mạnh.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "vi",
      supportLanguageTag: "",
      expression: "nước",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "id",
    expression: "air",
    sentence: "Tanaman kemangi membutuhkan air agar tetap sehat.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "id",
      supportLanguageTag: "",
      expression: "air",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "tr",
    expression: "su",
    sentence: "Fesleğenin sağlıklı kalması için su gereklidir.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "tr",
      supportLanguageTag: "",
      expression: "su",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "nl",
    expression: "water",
    sentence: "De basilicum op mijn vensterbank heeft water nodig.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "nl",
      supportLanguageTag: "",
      expression: "water",
      senseEnglish,
    },
  },
  {
    targetLanguageTag: "pl",
    expression: "Woda",
    sentence: "Woda jest niezbędna bazylii na moim parapecie.",
    semanticBaselineEnglish:
      "The liquid that a basil plant absorbs through its roots to stay healthy.",
    browserContext,
    expectedLabels: {
      targetLanguageTag: "pl",
      supportLanguageTag: "",
      expression: "Woda",
      senseEnglish,
    },
  },
];

const supportLanguageTags = sensaLanguageForRole("support").map(
  (language) => language.tag,
);

/** All supported Target × Support pairs, including same-language routes. */
export const languageMatrixCases: readonly LanguageMatrixCase[] =
  languageTargetFixtures.flatMap((fixture) =>
    supportLanguageTags.map((supportLanguageTag) => ({
      targetLanguageTag: fixture.targetLanguageTag,
      supportLanguageTag,
      supportFixture: languageSupportFixtures[supportLanguageTag]!,
      fixture: {
        ...fixture,
        expectedLabels: { ...fixture.expectedLabels, supportLanguageTag },
      },
    })),
  );
