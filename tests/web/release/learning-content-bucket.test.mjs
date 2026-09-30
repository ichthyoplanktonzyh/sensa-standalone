import {describe, expect, it, vi} from "vitest";

import {
  ensurePublicLearningContentBucket,
  learningContentMimeTypes,
  portableBookContentType,
  readPublishedLearningContent,
} from "../../../scripts/release/learningContentBucket.mjs";

const publicBucket = {
  id: "learning",
  name: "learning",
  public: true,
  allowed_mime_types: ["application/json", "application/zip"],
};

describe("learning content publication bucket", () => {
  it("retries public verification after an ambiguous upload timeout", async () => {
    const expected = Buffer.from("immutable learning content");
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
      .mockResolvedValueOnce(new Response(expected, {status: 200}));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(readPublishedLearningContent(
      "https://content.example/book.sensa-book",
      "book.sensa-book",
      {fetchImpl, sleep},
    )).resolves.toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("publishes portable Books with a MIME type admitted by the bucket", () => {
    expect(portableBookContentType).toBe("application/zip");
    expect(learningContentMimeTypes).toContain(portableBookContentType);
  });

  it("reuses an existing public bucket without rewriting provider policy", async () => {
    const storage = {
      getBucket: vi.fn().mockResolvedValue({data: publicBucket, error: null}),
      createBucket: vi.fn(),
      updateBucket: vi.fn(),
    };

    await expect(ensurePublicLearningContentBucket(storage, "learning"))
      .resolves.toEqual(publicBucket);
    expect(storage.createBucket).not.toHaveBeenCalled();
    expect(storage.updateBucket).not.toHaveBeenCalled();
  });

  it("creates a missing bucket as public with the required content types", async () => {
    const storage = {
      getBucket: vi.fn()
        .mockResolvedValueOnce({data: null, error: new Error("not found")})
        .mockResolvedValueOnce({data: publicBucket, error: null}),
      createBucket: vi.fn().mockResolvedValue({data: {name: "learning"}, error: null}),
      updateBucket: vi.fn(),
    };

    await ensurePublicLearningContentBucket(storage, "learning");

    expect(storage.createBucket).toHaveBeenCalledWith("learning", {
      public: true,
      allowedMimeTypes: ["application/json", "application/zip"],
    });
    expect(storage.updateBucket).not.toHaveBeenCalled();
  });

  it("only changes visibility when an existing bucket is private", async () => {
    const storage = {
      getBucket: vi.fn()
        .mockResolvedValueOnce({data: {...publicBucket, public: false}, error: null})
        .mockResolvedValueOnce({data: publicBucket, error: null}),
      createBucket: vi.fn(),
      updateBucket: vi.fn().mockResolvedValue({data: {}, error: null}),
    };

    await ensurePublicLearningContentBucket(storage, "learning");

    expect(storage.updateBucket).toHaveBeenCalledWith("learning", {public: true});
    expect(storage.createBucket).not.toHaveBeenCalled();
  });

  it("extends a restricted legacy bucket without replacing its size policy", async () => {
    const legacyBucket = {
      ...publicBucket,
      allowed_mime_types: ["application/json"],
      file_size_limit: 50 * 1024 * 1024,
    };
    const storage = {
      getBucket: vi.fn()
        .mockResolvedValueOnce({data: legacyBucket, error: null})
        .mockResolvedValueOnce({data: publicBucket, error: null}),
      createBucket: vi.fn(),
      updateBucket: vi.fn().mockResolvedValue({data: {}, error: null}),
    };

    await ensurePublicLearningContentBucket(storage, "learning");

    expect(storage.updateBucket).toHaveBeenCalledWith("learning", {
      public: true,
      allowedMimeTypes: ["application/json", "application/zip"],
    });
    expect(storage.updateBucket.mock.calls[0][1]).not.toHaveProperty("fileSizeLimit");
  });
});
