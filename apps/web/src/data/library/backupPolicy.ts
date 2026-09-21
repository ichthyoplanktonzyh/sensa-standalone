import {libraryTables,type Table} from './store';

/** Account/manual recovery carries durable facts, never reproducible public artifacts. */
export const libraryBackupTables=libraryTables.filter(
 (table):table is Exclude<Table,'packageCache'>=>table!=='packageCache',
);
