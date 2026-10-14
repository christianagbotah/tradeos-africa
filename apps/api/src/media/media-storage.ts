import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ManagedImageMime = "image/jpeg" | "image/png" | "image/webp";
export type ManagedImagePurpose = "AVATAR" | "BUSINESS_LOGO";

export interface StoredImage {
  storageName: string;
  mimeType: ManagedImageMime;
  sizeBytes: number;
}

export class MediaStorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function storeImage(input: {
  bytes: Buffer;
  declaredMime: string;
  purpose: ManagedImagePurpose;
}): Promise<StoredImage> {
  if (input.bytes.length > MAX_IMAGE_BYTES) {
    throw new MediaStorageError("Image exceeds the 5 MiB upload limit", "MEDIA_TOO_LARGE", 413);
  }
  if (input.bytes.length === 0) {
    throw new MediaStorageError("Image data is empty or unsupported", "MEDIA_TYPE_UNSUPPORTED", 415);
  }

  const detected = detectImage(input.bytes);
  if (!detected) {
    throw new MediaStorageError("Only JPEG, PNG and WebP images are supported", "MEDIA_TYPE_UNSUPPORTED", 415);
  }
  const declared = input.declaredMime.trim().toLowerCase();
  if (declared !== detected.mimeType) {
    throw new MediaStorageError("Uploaded image type does not match its content", "MEDIA_TYPE_MISMATCH", 415);
  }

  const root = mediaRoot();
  await mkdir(root, { recursive: true, mode: 0o750 });
  const storageName = `${randomUUID()}${detected.extension}`;
  const path = resolveStoredImage(storageName);
  try {
    await writeFile(path, input.bytes, { flag: "wx", mode: 0o640 });
  } catch (error) {
    throw new MediaStorageError(
      `Managed image could not be stored${error instanceof Error ? `: ${error.message}` : ""}`,
      "MEDIA_STORAGE_FAILED",
      500,
    );
  }
  return { storageName, mimeType: detected.mimeType, sizeBytes: input.bytes.length };
}

export function resolveStoredImage(storageName: string): string {
  if (storageName !== basename(storageName) || !/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(storageName)) {
    throw new MediaStorageError("Managed media name is invalid", "MEDIA_STORAGE_NAME_INVALID", 400);
  }
  const root = mediaRoot();
  const path = resolve(root, storageName);
  if (!path.startsWith(`${root}/`)) {
    throw new MediaStorageError("Managed media path is invalid", "MEDIA_STORAGE_NAME_INVALID", 400);
  }
  return path;
}

export async function removeStoredImage(storageName: string): Promise<void> {
  const path = resolveStoredImage(storageName);
  try {
    await unlink(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
}

export async function readStoredImage(storageName: string): Promise<Buffer> {
  return readFile(resolveStoredImage(storageName));
}

function mediaRoot(): string {
  const configured = process.env.MEDIA_STORAGE_ROOT?.trim() || process.env.TRADEOS_MEDIA_ROOT?.trim();
  if (!configured || !isAbsolute(configured)) {
    throw new MediaStorageError("MEDIA_STORAGE_ROOT must be an absolute path", "MEDIA_STORAGE_UNAVAILABLE", 500);
  }
  return resolve(configured);
}

function detectImage(bytes: Buffer): { mimeType: ManagedImageMime; extension: ".jpg" | ".png" | ".webp" } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  return null;
}
