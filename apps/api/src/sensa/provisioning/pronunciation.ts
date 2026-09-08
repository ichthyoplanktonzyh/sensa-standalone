import type {DatabaseExecutor} from '../../database/index.js';
import {bytesDigest} from '../media/consumer.js';
/** Reuse a controlled publisher's static pronunciation, bound to the exact accepted expression. */
export async function resolveStaticPronunciation(db:DatabaseExecutor,expression:string){
 const digest=await bytesDigest(new TextEncoder().encode(expression));
 const row=(await db.query('SELECT digest,source_text_digest,producer FROM sensa_consumer.published_media WHERE source_text_digest=$1 ORDER BY verified_at DESC,digest LIMIT 1',[digest])).rows[0];
 return row?{digest:row.digest,sourceTextDigest:row.source_text_digest,producer:row.producer}:null;
}
