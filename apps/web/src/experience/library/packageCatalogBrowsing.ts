import type {ShellParams} from '../router/screenRegistry';
import type {PackageCenterItem} from './packageCenterProjection';

export type CatalogBrowsing = Readonly<{
 query:string;
 target:string;
 support:string;
 sort:'title'|'newest';
 page:number;
 pageSize:24|48|96;
 view:'cards'|'list';
}>;

export function parseCatalogBrowsing(params:ShellParams):CatalogBrowsing{
 const [target='',support='']=params.route?.split(':')??[];
 const page=Number(params.page);
 return {
  query:params.query??'',target,support,
  sort:params.sort==='newest'?'newest':'title',
  page:Number.isSafeInteger(page)&&page>0?page:1,
  pageSize:params.pageSize==='48'?48:params.pageSize==='96'?96:24,
  view:params.view==='list'?'list':'cards',
 };
}

export const catalogBrowsingParams=(value:CatalogBrowsing):ShellParams=>({
 query:value.query||undefined,
 route:value.target||value.support?`${value.target}:${value.support}`:undefined,
 sort:value.sort,page:String(value.page),pageSize:String(value.pageSize),view:value.view,
});

/** Registry v3 supplies the complete, verified snapshot (at most 1,000 Books).
 * Filter before slicing; a loaded prefix cannot be substituted for this input. */
export function browseCatalog(
 items:readonly PackageCenterItem[],state:CatalogBrowsing,
 languageNames:ReadonlyMap<string,string>,locale:string,
){
 const query=state.query.trim().toLocaleLowerCase(locale);
 const collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'});
 const results=items.filter(item=>(!state.target||item.targetLanguage===state.target)
  &&(!state.support||item.supportLanguage===state.support)
  &&[item.title,item.description,item.targetLanguage,item.supportLanguage,
   item.descriptor?.publisher.name,languageNames.get(item.targetLanguage),languageNames.get(item.supportLanguage),
  ].join(' ').toLocaleLowerCase(locale).includes(query))
  .sort((left,right)=>{
   const primary=state.sort==='newest'
    ?Date.parse(right.descriptor?.publishedAt??'1970-01-01T00:00:00Z')-Date.parse(left.descriptor?.publishedAt??'1970-01-01T00:00:00Z')
    :collator.compare(left.title,right.title);
   // An exact ID comparison makes ties independent of transport order/locale.
   return primary||(left.listKey<right.listKey?-1:left.listKey>right.listKey?1:0);
  });
 const total=results.length,pages=Math.max(1,Math.ceil(total/state.pageSize));
 const page=Math.min(state.page,pages),start=total?(page-1)*state.pageSize+1:0;
 return {items:results.slice((page-1)*state.pageSize,page*state.pageSize),total,pages,page,start,end:Math.min(page*state.pageSize,total)};
}

/** Always expose first/last and the current neighborhood without a long row. */
export function catalogPageNumbers(page:number,pages:number):readonly (number|'gap')[]{
 const numbers=[...new Set([1,pages,page-1,page,page+1])].filter(value=>value>=1&&value<=pages).sort((a,b)=>a-b);
 return numbers.flatMap((number,index)=>index&&number-numbers[index-1]!>1?['gap' as const,number]:[number]);
}
