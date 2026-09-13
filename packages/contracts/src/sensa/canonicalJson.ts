/** Canonical JSON for persisted operation identities and content digests. */
export function canonicalConsumerJson(value:unknown):string{
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalConsumerJson).join(',')+']';
  if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
    const object=value as Record<string,unknown>;
    const compare=(a:string,b:string)=>{
      const left=Array.from(a,character=>character.codePointAt(0)!);
      const right=Array.from(b,character=>character.codePointAt(0)!);
      for(let index=0;index<Math.min(left.length,right.length);index++)if(left[index]!==right[index])return left[index]!-right[index]!;
      return left.length-right.length;
    };
    return '{'+Object.keys(object).sort(compare).map(key=>JSON.stringify(key)+':'+canonicalConsumerJson(object[key])).join(',')+'}';
  }
  throw new Error('Invalid canonical JSON value');
}
