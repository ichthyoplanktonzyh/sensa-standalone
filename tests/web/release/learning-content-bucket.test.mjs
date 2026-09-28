import {describe, expect, it, vi} from "vitest";

import {ensurePublicLearningContentBucket} from "../../../scripts/release/learningContentBucket.mjs";

const publicBucket = {id: "learning", name: "learning", public: true};

describe("learning content publication bucket", () => {
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
});
