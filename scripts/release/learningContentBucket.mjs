const bucketError = (message, error) => {
  const detail = typeof error?.message === "string" ? `: ${error.message}` : "";
  return new Error(`${message}${detail}`);
};

export const portableBookContentType = "application/zip";
export const learningContentMimeTypes = ["application/json", portableBookContentType];

/**
 * Make sure immutable learning content can be read without authentication.
 * Existing public buckets are deliberately left unchanged: publication owns
 * content objects, not provider-wide storage policy.
 */
export async function ensurePublicLearningContentBucket(storage, bucket) {
  const requiredMimeTypes = learningContentMimeTypes;
  let result = await storage.getBucket(bucket);
  if (result.error) {
    const created = await storage.createBucket(bucket, {
      public: true,
      allowedMimeTypes: requiredMimeTypes,
    });
    if (created.error) {
      throw bucketError("Learning content bucket is unavailable", created.error);
    }
  } else {
    const allowedMimeTypes = result.data?.allowed_mime_types;
    const missingMimeTypes = Array.isArray(allowedMimeTypes)
      ? requiredMimeTypes.filter((type) => !allowedMimeTypes.includes(type))
      : [];
    const update = {
      public: true,
      ...(missingMimeTypes.length > 0
        ? {allowedMimeTypes: [...allowedMimeTypes, ...missingMimeTypes]}
        : {}),
    };
    const needsUpdate = !result.data?.public || missingMimeTypes.length > 0;
    const updated = needsUpdate
      ? await storage.updateBucket(bucket, update)
      : {error: null};
    if (updated.error) {
      throw bucketError("Learning content bucket policy could not be prepared", updated.error);
    }
  }

  result = await storage.getBucket(bucket);
  if (result.error || !result.data?.public) {
    throw bucketError("Learning content bucket must be public", result.error);
  }
  return result.data;
}
