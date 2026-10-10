/** Source-backed subtitle intervals, in seconds. No invented word timestamps. */
export type Cue={text:string;start:number;end:number};
type Piece=Cue & {join?:string};
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

/**
 * Sentence boundaries may split timed pieces, never the inside of an untimed row.
 *
 * `language` is the language the captions are actually in. The abbreviation
 * guard below stays English-specific on purpose: it exists for the one language
 * whose captions are dense with `Dr.` and `St.`, and applying it elsewhere would
 * drop boundaries no other language's punctuation justifies.
 */
export function groupSubtitlePieces(input:Piece[],language?:string):Cue[]{
  if(input.length>60000)throw new Error('captions_too_large');
  const pieces=input.filter(c=>c.text.trim()&&c.text.length<=12000&&finite(c.start)&&finite(c.end)&&c.start>=0&&c.end>c.start&&c.end<=86400).sort((a,b)=>a.start-b.start);
  let text='';
  const spans=pieces.map(piece=>{const join=text?(piece.join??' '):'';text+=join;const offset=text.length;text+=piece.text;return {piece,offset};});
  const boundaries=Array.from(new Intl.Segmenter(language,{granularity:'sentence'}).segment(text),part=>part.index+part.segment.trimEnd().length)
    .filter(end=>!/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.|\b[A-Z]\.)$/u.test(text.slice(Math.max(0,end-16),end)));
  const cues:Cue[]=[];let buffer:Cue|null=null,previousOffset=0,boundary=0;
  for(const {piece,offset} of spans){
    while(boundary<boundaries.length&&boundaries[boundary]<=previousOffset)boundary++;
    const sentenceEnded=boundaries[boundary]<=offset;
    const separated=buffer&&(sentenceEnded||piece.start-buffer.end>2||piece.end-buffer.start>18||buffer.text.length+piece.text.length>400);
    if(buffer&&separated){cues.push(buffer);buffer=null;}
    if(buffer){buffer.text+=(piece.join??' ')+piece.text;buffer.end=Math.max(buffer.end,piece.end);}
    else buffer={text:piece.text,start:piece.start,end:piece.end};
    previousOffset=offset;
  }
  if(buffer)cues.push(buffer);
  // Caption display windows can overlap; later source intervals take precedence.
  for(let i=0;i<cues.length-1;i++)if(cues[i+1].start>cues[i].start)cues[i].end=Math.min(cues[i].end,cues[i+1].start);
  return cues.map(c=>({...c,text:c.text.trim()})).filter(c=>c.text&&c.end>c.start);
}

export function parseYoutubeCaptions(text:string,language?:string):Cue[]{
  const data=JSON.parse(text);
  if(!Array.isArray(data.events))throw new Error('invalid_subtitles');
  if(data.events.length>10000)throw new Error('captions_too_large');
  type Event={tStartMs:number;dDurationMs?:number;wWinId?:number;segs?:{utf8?:string;tOffsetMs?:number}[]};
  const events=(data.events as Event[]).filter(e=>e&&finite(e.tStartMs)&&e.tStartMs>=0&&e.tStartMs<86400000).sort((a,b)=>a.tStartMs-b.tStartMs);
  // Same window/start is a repaint, not another spoken occurrence. Later repeats remain.
  const rows=new Map<string,Event>();
  for(const event of events)if(Array.isArray(event.segs)&&event.segs.some(s=>s&&typeof s.utf8==='string'&&s.utf8.trim()))rows.set(`${event.tStartMs}:${event.wWinId??''}`,event);
  const ordered=[...rows.values()];const pieces:Piece[]=[];
  for(let row=0;row<ordered.length;row++){
    const event=ordered[row],next=ordered[row+1]?.tStartMs;
    const end=finite(event.dDurationMs)&&event.dDurationMs>0?event.tStartMs+event.dDurationMs:next;
    if(!finite(end)||end<=event.tStartMs||end>86400000)continue;
    const segments:{text:string;start:number}[]=[];let offset=0;
    for(const segment of event.segs!){
      if(!segment||typeof segment.utf8!=='string')continue;
      if(finite(segment.tOffsetMs)&&segment.tOffsetMs>=offset&&event.tStartMs+segment.tOffsetMs<end)offset=segment.tOffsetMs;
      const start=event.tStartMs+offset,last=segments.at(-1);
      if(last?.start===start)last.text+=segment.utf8;else segments.push({text:segment.utf8,start});
    }
    for(let index=0;index<segments.length;index++){
      const segment=segments[index],previous=segments[index-1];
      if(!segment.text.trim())continue;
      const until=Math.min(segments[index+1]?.start??end,next>segment.start?next:end);
      const join=index===0||/\s$/u.test(previous?.text??'')||/^\s/u.test(segment.text)?' ':'';
      pieces.push({text:segment.text.trim(),start:segment.start/1000,end:until/1000,join});
    }
  }
  return groupSubtitlePieces(pieces,language);
}

export function parseSubtitleFile(text:string,language?:string):Cue[]{
  const seconds=(stamp:string)=>stamp.replace(',','.').split(':').map(Number).reduce((total,n)=>total*60+n,0);
  const cues:Cue[]=[];
  for(const block of text.replace(/\r/gu,'').split(/\n\s*\n/u)){
    const lines=block.split('\n'),index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
    const match=lines[index].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/u);if(!match)continue;
    const plain=new DOMParser().parseFromString(lines.slice(index+1).join('\n'),'text/html').body.textContent??'';
    cues.push({text:plain.trim(),start:seconds(match[1]),end:seconds(match[2])});
  }
  return groupSubtitlePieces(cues,language);
}
