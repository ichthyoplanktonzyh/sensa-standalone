import assert from 'node:assert/strict';
import {selectReadingConnection} from '../apps/api/src/sensa/reading/service.ts';
const old=process.env.SENSA_MANAGED_MODELS_PAUSED;process.env.SENSA_MANAGED_MODELS_PAUSED='1';
try{assert.throws(()=>selectReadingConnection({providers:[],assignments:{meaning:null} as any},'meaning'),/managed_models_paused/);}finally{if(old===undefined)delete process.env.SENSA_MANAGED_MODELS_PAUSED;else process.env.SENSA_MANAGED_MODELS_PAUSED=old;}
console.log('PASS: managed-service pause blocks default model selection without provider calls.');
