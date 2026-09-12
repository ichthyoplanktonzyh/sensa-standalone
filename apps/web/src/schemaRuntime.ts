import {z} from 'zod';
/** The hosted Web security policy has no `unsafe-eval`, and zod compiles object
 * parsers with the `Function` constructor by default. Chrome reports that as a
 * blocked dynamic-code violation on every load, so the browser runtime asks zod
 * for its interpreted parser instead. Loaded before any schema is built. */
z.config({jitless:true});
