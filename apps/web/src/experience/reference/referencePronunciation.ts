import type {QuickDictEntry} from '../types';
import type {ReferencePronunciationInput} from '../services/audioService';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {cardText} from '../../i18n/originalCards';
import i18n from '../../i18n';

/** Labels and playback share the same provider-owned source, not the Route. */
export function referencePronunciationPresentation(entry:QuickDictEntry):{input:ReferencePronunciationInput;label:string;ipa:string}|null{
 const release=entry.referenceLookup?.release;if(!release)return null;
 const source=entry.referenceLookup?.entry.pronunciations[0];
 const tag=source?.accent??release.targetLanguage;
 const label=tag==='en-US'?cardText('american'):tag==='en-GB'?cardText('british'):interfaceLanguageDisplayName(tag,resolveInterfaceLocale(i18n.language));
 return {input:{text:entry.word,languageTag:tag,audioUrl:source?.audioUrl},label,ipa:source?.ipa??''};
}
