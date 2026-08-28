export type PresignedMediaAssetDownload = Readonly<{
  method: "GET";
  url: string;
  expiresAt: string;
  rangeRequests: boolean;
}>;
