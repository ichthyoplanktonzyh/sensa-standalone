import {executeModel as execute,modelQueue} from '@sensa/model-runtime';
import {ModelExecutionError} from '@sensa/contracts/sensa';
import {ConsumerError} from '../access/auth.js';
export {modelQueue};
export const executeModel:typeof execute=async(...args)=>{try{return await execute(...args);}catch(e){if(e instanceof ModelExecutionError)throw new ConsumerError(503,e.code);throw e;}};
