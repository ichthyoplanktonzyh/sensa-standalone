/** Decode one provider caption transport layer. Observed Widget events include
 * single-byte %F1/%E9; UTF-8 events and literal percentages remain valid too. */
export function decodeYouglishCaption(raw:string):string{
  return raw.replace(/%u([\da-f]{4})|((?:%[\da-f]{2})+)/giu,(_match,wide:string|undefined,bytes:string|undefined)=>{
    if(wide)return String.fromCharCode(Number.parseInt(wide,16));
    try{return decodeURIComponent(bytes!);}catch{
      return bytes!.replace(/%([\da-f]{2})/giu,(_byte,hex:string)=>String.fromCharCode(Number.parseInt(hex,16)));
    }
  });
}
