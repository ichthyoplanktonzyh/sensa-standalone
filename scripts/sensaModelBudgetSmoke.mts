import assert from 'node:assert/strict';
import {selectConnection} from '../apps/api/src/sensa/reading/service.ts';
const old=process.env.SENSA_MANAGED_MODELS_PAUSED;process.env.SENSA_MANAGED_MODELS_PAUSED='1';
try{
 // A pause blocks the managed default for every purpose, reading and model alike.
 for(const feature of ['meaning','teacher','content','reference'] as const)assert.throws(()=>selectConnection({providers:[],assignments:{meaning:null} as any},feature),/managed_models_paused/);
}finally{if(old===undefined)delete process.env.SENSA_MANAGED_MODELS_PAUSED;else process.env.SENSA_MANAGED_MODELS_PAUSED=old;}
console.log('PASS: managed-service pause blocks default model selection for every purpose without provider calls.');
