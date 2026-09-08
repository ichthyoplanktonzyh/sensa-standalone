/** Read only the proposal's explanation string from an incomplete JSON prefix.
 * This is ephemeral display text, never a Proposal or an acceptance input. */
export function explanationPreview(json:string):string|null{
  const head=json.match(/^\s*\{\s*"proposal"\s*:\s*\{/u);if(!head)return null;
  function quoted(start:number){
    let value='',index=start+1;
    while(index<json.length){
      const character=json[index++];
      if(character==='"')return {value,index,complete:true};
      if(character==='\\'){
        if(index>=json.length)break;
        const escape=json[index++];
        if(escape==='u'){if(index+4>json.length)break;const hex=json.slice(index,index+4);if(!/^[\da-f]{4}$/iu.test(hex))return null;value+=String.fromCharCode(parseInt(hex,16));index+=4;}
        else{const mapped:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!(escape in mapped))return null;value+=mapped[escape];}
      }else{if(character<' ')return null;value+=character;}
    }
    return {value,index,complete:false};
  }
  let depth=2;
  for(let index=head[0].length;index<json.length;){
    const character=json[index];
    if(character==='"'){
      const token=quoted(index);if(!token||!token.complete)return null;index=token.index;
      if(depth===2&&token.value==='explanation'){
        while(/\s/u.test(json[index]??'')&&index<json.length)index++;
        if(json[index++]!==':')continue;
        while(/\s/u.test(json[index]??'')&&index<json.length)index++;
        if(json[index]!=='"')return null;
        return quoted(index)?.value??null;
      }
    }else{if(character==='{'||character==='[')depth++;if(character==='}'||character===']')depth--;index++;}
  }
  return null;
}
