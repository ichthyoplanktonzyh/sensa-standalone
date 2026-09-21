export const translationNamespaces=[
  'common',
  'account',
  'content',
  'learning',
  'profile',
  'reference',
  'localFlow',
  'originalCards',
  'version',
] as const;

export type TranslationNamespace=typeof translationNamespaces[number];
