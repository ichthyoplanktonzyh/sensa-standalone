import {useCallback,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {defaultRangeExtractor,useVirtualizer,type Range} from '@tanstack/react-virtual';

interface ListProps<Item>{
 items:readonly Item[];
 itemKey:(item:Item)=>string;
 renderItem:(item:Item)=>ReactNode;
 label:string;
 estimateSize?:number;
 scrollElement?:()=>HTMLElement|null;
 plain?:boolean;
}

/** Preserve the page's scrollbar and full collection; mount only its current window. */
export function SensaVirtualList<Item>(props:ListProps<Item>){
 if(props.items.length<=80)return <div role="list" aria-label={props.label} className={props.plain?undefined:'divide-y divide-border-subtle border-y border-border-subtle'}>
  {props.items.map((item,index)=><div key={props.itemKey(item)} role="listitem" aria-posinset={index+1} aria-setsize={props.items.length}>{props.renderItem(item)}</div>)}
 </div>;
 return <WindowedList {...props}/>;
}

function WindowedList<Item>({items,itemKey,renderItem,label,estimateSize=144,scrollElement,plain}:ListProps<Item>){
 return <IndexedWindow count={items.length} itemAt={index=>items[index]} indexForKey={key=>items.findIndex(item=>itemKey(item)===key)} itemKey={itemKey} renderItem={renderItem} label={label} estimateSize={estimateSize} scrollElement={scrollElement} plain={plain}/>;
}
interface PagedListProps<Item>{
 count:number;itemAt:(index:number)=>Item|undefined;itemKey:(item:Item)=>string;renderItem:(item:Item)=>ReactNode;
 label:string;estimateSize?:number;request?:(indexes:readonly number[])=>void;indexForKey?:(key:string)=>number;
 scrollElement?:()=>HTMLElement|null;plain?:boolean;
}
/** The same page scrollbar, without requiring the caller to load every row. */
export function SensaPagedVirtualList<Item>(props:PagedListProps<Item>){return <IndexedWindow {...props}/>;}
function IndexedWindow<Item>({count,itemAt,itemKey,renderItem,label,estimateSize=144,request,indexForKey,scrollElement,plain}:PagedListProps<Item>){
 const list=useRef<HTMLDivElement>(null);
 const [scrollMargin,setScrollMargin]=useState(0),[focus,setFocus]=useState<{key:string;index:number}|null>(null);
 const focusedIndex=focus?(indexForKey?indexForKey(focus.key):focus.index):-1;
 const keyForIndex=useCallback((index:number)=>{const item=itemAt(index);return item?itemKey(item):`pending:${index}`;},[itemAt,itemKey]);
 const ranges=useCallback((range:Range)=>{
  const indexes=defaultRangeExtractor(range);
  // Scrolling must not unmount the keyboard's current focus owner.
  if(focusedIndex>=0&&focusedIndex<count&&!indexes.includes(focusedIndex))indexes.push(focusedIndex);
  return indexes.sort((left,right)=>left-right);
 },[focusedIndex,count]);
 const virtualizer=useVirtualizer<HTMLElement,HTMLDivElement>({
  count,getScrollElement:()=>scrollElement?.()??list.current?.closest<HTMLElement>('[data-sensa-page-layout="collection-browser"]')??null,
  getItemKey:keyForIndex,estimateSize:()=>estimateSize,overscan:8,scrollMargin,rangeExtractor:ranges,
  initialRect:{width:1024,height:900},
 });
 const rows=virtualizer.getVirtualItems();
 const indexes=rows.map(row=>row.index).join(',');
 useLayoutEffect(()=>{request?.(rows.map(row=>row.index));},[request,indexes,itemAt]);
 useLayoutEffect(()=>{
  const node=list.current,owner=scrollElement?.()??node?.closest<HTMLElement>('[data-sensa-page-layout="collection-browser"]');
  if(!node||!owner)return;
  const measure=()=>setScrollMargin(node.getBoundingClientRect().top-owner.getBoundingClientRect().top+owner.scrollTop);
  measure();
  const observer=new ResizeObserver(measure);
  observer.observe(owner);
  // Header, controls and batch panels can move the list without resizing the viewport.
  for(let parent:HTMLElement|null=node.parentElement;parent;parent=parent.parentElement){
   for(const child of parent.children)if(child instanceof HTMLElement)observer.observe(child);
   if(parent===owner)break;
  }
  return ()=>observer.disconnect();
 },[scrollElement]);
 return <div ref={list} role="list" aria-label={label} className={`relative ${plain?'':'border-y border-border-subtle'}`} style={{height:virtualizer.getTotalSize(),overflowAnchor:'none'}}
  onFocusCapture={event=>{
   const target=(event.target as Element).closest<HTMLElement>('[data-sensa-virtual-index]');
   if(target){const index=Number(target.dataset.sensaVirtualIndex);setFocus({index,key:keyForIndex(index)});}
  }} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setFocus(null);}}>
  {rows.map(row=>{const item=itemAt(row.index);return <div key={row.key} ref={virtualizer.measureElement} data-index={row.index} data-sensa-virtual-index={row.index}
   role="listitem" aria-busy={!item||undefined} aria-posinset={row.index+1} aria-setsize={count} className={`absolute left-0 top-0 w-full ${plain?'':'border-b border-border-subtle'}`}
   style={{transform:`translateY(${row.start-scrollMargin}px)`}}>{item?renderItem(item):<div aria-hidden="true" className="animate-pulse bg-surface-subtle" style={{height:estimateSize}}/>}</div>;})}
 </div>;
}
