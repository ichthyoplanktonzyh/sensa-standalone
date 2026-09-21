export const translationNamespaces=[
  'common',
  'account',
  'content',
  'learning',
  'profile',
  'reference',
  'localFlow',
  'originalCards',
] as const;

export type TranslationNamespace=typeof translationNamespaces[number];
