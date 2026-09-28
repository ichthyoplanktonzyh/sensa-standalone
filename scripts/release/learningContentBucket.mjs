const bucketError = (message, error) => {
  const detail = typeof error?.message === "string" ? `: ${error.message}` : "";
  return new Error(`${message}${detail}`);
};

/**
 * Make sure immutable learning content can be read without authentication.
 * Existing public buckets are deliberately left unchanged: publication owns
 * content objects, not provider-wide storage policy.
 */
export async function ensurePublicLearningContentBucket(storage, bucket) {
  let result = await storage.getBucket(bucket);
  if (result.error) {
    const created = await storage.createBucket(bucket, {
      public: true,
      allowedMimeTypes: ["application/json", "application/zip"],
    });
    if (created.error) {
      throw bucketError("Learning content bucket is unavailable", created.error);
    }
  } else if (!result.data?.public) {
    const updated = await storage.updateBucket(bucket, {public: true});
    if (updated.error) {
      throw bucketError("Learning content bucket could not be made public", updated.error);
    }
  }

  result = await storage.getBucket(bucket);
  if (result.error || !result.data?.public) {
    throw bucketError("Learning content bucket must be public", result.error);
  }
  return result.data;
}
