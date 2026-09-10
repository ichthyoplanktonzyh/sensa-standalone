/** Tagged structured-clone subset: Dates and undefined must survive JSON backup. */
export type WireValue=unknown;
export function encodeBackupValue(value:unknown,depth=0):WireValue{
 if(depth>80)throw new Error('备份数据嵌套过深。');
 if(value===null)return ['null'];if(value===undefined)return ['undefined'];
 if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
 if(typeof value==='number'&&Number.isFinite(value))return ['number',value];
 if(value instanceof Date&&Number.isFinite(value.getTime()))return ['date',value.toISOString()];
 if(Array.isArray(value))return ['array',value.map(v=>encodeBackupValue(v,depth+1))];
 if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return ['object',Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,encodeBackupValue(v,depth+1)])];
 throw new Error('备份包含不支持的数据类型。');
}
export function decodeBackupValue(node:any,depth=0):any{
 if(depth>80||!Array.isArray(node))throw new Error('备份数据格式无效。');
 const [kind,value]=node;
 if(node.length===1&&kind==='null')return null;if(node.length===1&&kind==='undefined')return undefined;
 if(node.length!==2)throw new Error('备份数据格式无效。');
 if(kind==='string'&&typeof value==='string'||kind==='boolean'&&typeof value==='boolean'||kind==='number'&&typeof value==='number'&&Number.isFinite(value))return value;
 if(kind==='date'&&typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value)return new Date(value);
 if(kind==='array'&&Array.isArray(value))return value.map(v=>decodeBackupValue(v,depth+1));
 if(kind==='object'&&Array.isArray(value)){const object:Record<string,unknown>={};const seen=new Set();for(const pair of value){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||seen.has(pair[0]))throw new Error('备份字段重复或无效。');seen.add(pair[0]);Object.defineProperty(object,pair[0],{value:decodeBackupValue(pair[1],depth+1),writable:true,enumerable:true,configurable:true});}return object;}
 throw new Error('备份数据格式无效。');
}
export const backupEqual=(a:unknown,b:unknown)=>JSON.stringify(encodeBackupValue(a))===JSON.stringify(encodeBackupValue(b));
