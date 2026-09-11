/** Encrypted capture delivery only. No learning history or scheduling authority. */
import {z} from 'zod';
import {CompactEncrypt,compactDecrypt,generateKeyPair,exportJWK,importJWK,calculateJwkThumbprint,base64url} from 'jose';
const id=z.string().uuid();
export const publicKeySchema=z.object({kty:z.literal('EC'),crv:z.literal('P-256'),x:z.string().length(43),y:z.string().length(43)}).strict();
const privateKeySchema=publicKeySchema.extend({d:z.string().length(43)}).strict();
export const deliveryScopeSchema=z.object({accountId:id,libraryId:id,keyId:z.string().length(43)}).strict();
export const deliveryConfigSchema=deliveryScopeSchema.extend({publicKey:publicKeySchema,recoveryEnvelope:z.string().max(5000)}).strict();
export const deliveryEnvelopeSchema=deliveryScopeSchema.extend({operationId:id,clientId:id,ciphertext:z.string().min(100).max(196608)}).strict();
export const deviceJoinSchema=deliveryScopeSchema.extend({deviceId:id,publicKey:publicKeySchema}).strict();
export type DeliveryConfig=z.infer<typeof deliveryConfigSchema>;
export type DeliveryEnvelope=z.infer<typeof deliveryEnvelopeSchema>;
export type DeliveryScope=z.infer<typeof deliveryScopeSchema>;
export type DeliverySecret=z.infer<typeof privateKeySchema>;
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const decode=(value:Uint8Array)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value));
async function pair(){const keys=await generateKeyPair('ECDH-ES',{crv:'P-256',extractable:true});const pub=await exportJWK(keys.publicKey),priv=await exportJWK(keys.privateKey);return {publicKey:publicKeySchema.parse(pub),privateKey:privateKeySchema.parse(priv)};}
function assertScope(expected:DeliveryScope,actual:DeliveryScope){if(expected.accountId!==actual.accountId||expected.libraryId!==actual.libraryId||expected.keyId!==actual.keyId)throw new Error('delivery_scope_mismatch');}
async function seal(value:unknown,publicKey:z.infer<typeof publicKeySchema>,scope:DeliveryScope,purpose:string){return new CompactEncrypt(encode(value)).setProtectedHeader({alg:'ECDH-ES',enc:'A256GCM',typ:purpose,...scope}).encrypt(await importJWK(publicKey,'ECDH-ES'));}
async function open(ciphertext:string,privateKey:DeliverySecret,scope:DeliveryScope,purpose:string){const result=await compactDecrypt(ciphertext,await importJWK(privateKeySchema.parse(privateKey),'ECDH-ES'),{keyManagementAlgorithms:['ECDH-ES'],contentEncryptionAlgorithms:['A256GCM']});assertScope(scope,deliveryScopeSchema.parse({accountId:result.protectedHeader.accountId,libraryId:result.protectedHeader.libraryId,keyId:result.protectedHeader.keyId}));if(result.protectedHeader.typ!==purpose)throw new Error('delivery_invalid_envelope');return decode(result.plaintext);}
export async function createDelivery(accountId:string,libraryId:string){
 const keys=await pair(),keyId=await calculateJwkThumbprint(keys.publicKey);const scope=deliveryScopeSchema.parse({accountId,libraryId,keyId});
 const recovery=crypto.getRandomValues(new Uint8Array(32));
 const recoveryEnvelope=await new CompactEncrypt(encode({...scope,privateKey:keys.privateKey})).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:'sensa-delivery-recovery-v1',...scope}).encrypt(recovery);
 return {config:{...scope,publicKey:keys.publicKey,recoveryEnvelope},privateKey:keys.privateKey,recoveryCode:'SENSA-'+base64url.encode(recovery)};
}
export async function recoverDelivery(config:DeliveryConfig,recoveryCode:string){
 const key=base64url.decode(recoveryCode.trim().replace(/^SENSA-/u,''));if(key.length!==32)throw new Error('delivery_invalid_recovery');
 const result=await compactDecrypt(config.recoveryEnvelope,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
 if(result.protectedHeader.typ!=='sensa-delivery-recovery-v1')throw new Error('delivery_invalid_recovery');
 const data=decode(result.plaintext);assertScope(config,deliveryScopeSchema.parse({accountId:data.accountId,libraryId:data.libraryId,keyId:data.keyId}));
 return validateDeliverySecret(config,data.privateKey);
}
export async function validateDeliverySecret(config:DeliveryConfig,raw:unknown){const secret=privateKeySchema.parse(raw);const {d:_,...pub}=secret;if(await calculateJwkThumbprint(pub)!==config.keyId||await calculateJwkThumbprint(config.publicKey)!==config.keyId)throw new Error('delivery_key_mismatch');await importJWK(secret,'ECDH-ES');return secret;}
export async function encryptCapture(config:DeliveryConfig,request:{operationId:string;clientId:string;libraryId:string}){
 if(request.libraryId!==config.libraryId||await calculateJwkThumbprint(config.publicKey)!==config.keyId)throw new Error('delivery_scope_mismatch');
 const scope=deliveryScopeSchema.parse({accountId:config.accountId,libraryId:config.libraryId,keyId:config.keyId});
 return deliveryEnvelopeSchema.parse({...scope,operationId:request.operationId,clientId:request.clientId,ciphertext:await seal(request,config.publicKey,scope,'sensa-capture-v1')});
}
export async function decryptCapture(config:DeliveryConfig,secret:DeliverySecret,raw:unknown){const envelope=deliveryEnvelopeSchema.parse(raw);assertScope(config,envelope);const value=await open(envelope.ciphertext,secret,config,'sensa-capture-v1');if(value.operationId!==envelope.operationId||value.clientId!==envelope.clientId||value.libraryId!==config.libraryId)throw new Error('delivery_scope_mismatch');return value;}
export async function createDeviceJoin(config:DeliveryConfig){const keys=await pair();return {request:{accountId:config.accountId,libraryId:config.libraryId,keyId:config.keyId,deviceId:crypto.randomUUID(),publicKey:keys.publicKey},privateKey:keys.privateKey};}
export async function deviceApprovalCode(request:z.infer<typeof deviceJoinSchema>){return (await calculateJwkThumbprint(request.publicKey)).slice(0,16);}
export async function approveDevice(config:DeliveryConfig,secret:DeliverySecret,raw:unknown){const request=deviceJoinSchema.parse(raw);assertScope(config,request);await validateDeliverySecret(config,secret);return seal({deviceId:request.deviceId,privateKey:secret},request.publicKey,config,'sensa-device-grant-v1');}
export async function receiveDeviceGrant(config:DeliveryConfig,join:Awaited<ReturnType<typeof createDeviceJoin>>,grant:string){const value=await open(grant,join.privateKey,config,'sensa-device-grant-v1');if(value.deviceId!==join.request.deviceId)throw new Error('delivery_scope_mismatch');return validateDeliverySecret(config,value.privateKey);}
