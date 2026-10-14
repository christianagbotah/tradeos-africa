import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  MediaStorageError,
  removeStoredImage,
  resolveStoredImage,
  storeImage,
} from "../src/media/media-storage.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tradeos-media-test-"));
  process.env.MEDIA_STORAGE_ROOT = root;
});

afterEach(async () => {
  delete process.env.MEDIA_STORAGE_ROOT;
  delete process.env.TRADEOS_MEDIA_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

const png = () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("png-payload")]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg-payload")]);
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.from("webp-payload")]);

describe("managed image storage", () => {
  it.each([
    ["image/png", png(), ".png"],
    ["image/jpeg", jpeg(), ".jpg"],
    ["image/webp", webp(), ".webp"],
  ] as const)("stores verified %s bytes under a random managed name", async (mimeType, bytes, extension) => {
    const first = await storeImage({ bytes, declaredMime: mimeType, purpose: "AVATAR" });
    const second = await storeImage({ bytes, declaredMime: mimeType, purpose: "AVATAR" });

    expect(first.mimeType).toBe(mimeType);
    expect(first.sizeBytes).toBe(bytes.length);
    expect(first.storageName).toMatch(new RegExp(`^[0-9a-f-]{36}\\${extension}$`));
    expect(second.storageName).not.toBe(first.storageName);
    expect(await readFile(resolveStoredImage(first.storageName))).toEqual(bytes);
  });

  it("rejects declared MIME that does not match the verified image signature", async () => {
    await expect(storeImage({ bytes: png(), declaredMime: "image/jpeg", purpose: "AVATAR" }))
      .rejects.toMatchObject({ code: "MEDIA_TYPE_MISMATCH" });
  });

  it("rejects unsupported or unrecognized bytes even when the filename-equivalent MIME looks safe", async () => {
    await expect(storeImage({ bytes: Buffer.from("not-an-image"), declaredMime: "image/png", purpose: "BUSINESS_LOGO" }))
      .rejects.toBeInstanceOf(MediaStorageError);
  });

  it("rejects images over the 5 MiB limit before persisting a file", async () => {
    const oversized = Buffer.concat([png(), Buffer.alloc(MAX_IMAGE_BYTES)]);
    await expect(storeImage({ bytes: oversized, declaredMime: "image/png", purpose: "AVATAR" }))
      .rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });

  it("refuses path traversal and removes stored files idempotently", async () => {
    expect(() => resolveStoredImage("../secret.png")).toThrowError(MediaStorageError);
    const stored = await storeImage({ bytes: jpeg(), declaredMime: "image/jpeg", purpose: "BUSINESS_LOGO" });
    const path = resolveStoredImage(stored.storageName);
    await stat(path);
    await removeStoredImage(stored.storageName);
    await removeStoredImage(stored.storageName);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
