/** Durable media-row contract shared by storage, backup and the UI cache. */
export const maxStoredMediaBytes=1_500_000;

export interface StoredMedia {
  mediaId:string;
  mediaKind:'image';
  mimeType:string;
  dataUrl:string;
  sizeBytes:number;
  createdAt:string;
}

const invalidMedia=():never=>{throw new Error('libraryBackup.errors.inconsistent');};

export const parseStoredMedia=(value:unknown):StoredMedia=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalidMedia();
  const media=value as Partial<StoredMedia>;
  if(
    typeof media.mediaId!=='string'||!media.mediaId||
    media.mediaKind!=='image'||
    typeof media.mimeType!=='string'||!media.mimeType.startsWith('image/')||
    typeof media.dataUrl!=='string'||!media.dataUrl.startsWith('data:image/')||
    typeof media.sizeBytes!=='number'||!Number.isInteger(media.sizeBytes)||
    media.sizeBytes<0||media.sizeBytes>maxStoredMediaBytes||
    typeof media.createdAt!=='string'||Number.isNaN(Date.parse(media.createdAt))
  )return invalidMedia();
  return media as StoredMedia;
};
