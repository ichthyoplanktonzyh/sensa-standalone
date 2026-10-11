import type {PackageCenterItem} from './packageCenterProjection';

/** A display name may use an exact phrase from a known generated description.
 * The published title/identity stays intact for search, metadata and admission. */
export function packagePresentation(item:Pick<PackageCenterItem,'title'|'description'>){
 const foundation=item.title.startsWith('IDS Route Foundation:')
  ?item.description.match(/^(.+?) for target [\w-]+ with support [\w-]+\.$/)?.[1]
  :undefined;
 const common=/^IDS 轻量学习：/.test(item.title)
  ?item.description.match(/^以.+为目标语言、.+为支持语言的(.+?)学习包。$/)?.[1]
  :undefined;
 const title=foundation??common??item.title;
 return {title,description:title===item.title?item.description:'',originalTitle:title===item.title?undefined:item.title};
}
