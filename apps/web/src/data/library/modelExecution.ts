import {ModelExecutionQueue} from '@sensa/contracts/sensa';
/** Local direct calls and managed calls share one device-side queue. */
export const localModelQueue=new ModelExecutionQueue();
