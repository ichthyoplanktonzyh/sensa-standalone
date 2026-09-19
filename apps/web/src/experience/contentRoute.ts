export const CONTENT_SECTION_IDS = [
  'recent',
  'learned',
  'known',
  'saved-senses',
  'saved-examples',
  'notes',
] as const;

export type ContentSectionId = (typeof CONTENT_SECTION_IDS)[number];

/** Narrow an untrusted section id without loading the content projection. */
export const isContentSectionId = (value:unknown):value is ContentSectionId=>
 typeof value==='string'&&(CONTENT_SECTION_IDS as readonly string[]).includes(value);
