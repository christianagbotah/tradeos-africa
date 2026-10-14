import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import {
  loadManagedMedia,
  removeAvatar,
  removeBusinessLogo,
  replaceAvatar,
  replaceBusinessLogo,
} from "./media-service.js";
import { MAX_IMAGE_BYTES, MediaStorageError } from "./media-storage.js";

export function registerMediaRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.register(multipart, {
    limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 0, parts: 1 },
  });

  app.post("/v1/me/avatar", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const upload = await readSingleImage(request);
      const media = await replaceAvatar(pool, auth, upload);
      return reply.code(201).send({ media });
    } catch (error) {
      return sendMediaError(request, reply, error);
    }
  });

  app.delete("/v1/me/avatar", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      await removeAvatar(pool, auth);
      return reply.code(204).send();
    } catch (error) {
      return sendMediaError(request, reply, error);
    }
  });

  app.post<{ Params: { businessId: string } }>("/v1/businesses/:businessId/logo", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      // Authorize before reading/storing the request body.
      const media = await replaceBusinessLogo(pool, auth, request.params.businessId, await readSingleImage(request));
      return reply.code(201).send({ media });
    } catch (error) {
      return sendMediaError(request, reply, error);
    }
  });

  app.delete<{ Params: { businessId: string } }>("/v1/businesses/:businessId/logo", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      await removeBusinessLogo(pool, auth, request.params.businessId);
      return reply.code(204).send();
    } catch (error) {
      return sendMediaError(request, reply, error);
    }
  });

  app.get<{ Params: { mediaId: string } }>("/v1/media/:mediaId", async (request, reply) => {
    try {
      const media = await loadManagedMedia(pool, request.params.mediaId);
      if (!media) return reply.code(404).send({ error: "MEDIA_NOT_FOUND", message: "Image is unavailable." });
      return reply
        .header("Content-Type", media.mimeType)
        .header("Content-Length", String(media.sizeBytes))
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff")
        .send(media.bytes);
    } catch (error) {
      return sendMediaError(request, reply, error);
    }
  });
}

async function readSingleImage(request: FastifyRequest): Promise<{ bytes: Buffer; declaredMime: string }> {
  try {
    const part = await request.file();
    if (!part) throw new MediaStorageError("Choose an image to upload", "MEDIA_REQUIRED", 400);
    const bytes = await part.toBuffer();
    if (part.file.truncated) throw new MediaStorageError("Image exceeds the 5 MiB upload limit", "MEDIA_TOO_LARGE", 413);
    return { bytes, declaredMime: part.mimetype };
  } catch (error) {
    if (isMultipartTooLarge(error)) {
      throw new MediaStorageError("Image exceeds the 5 MiB upload limit", "MEDIA_TOO_LARGE", 413);
    }
    throw error;
  }
}

function isMultipartTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ["FST_REQ_FILE_TOO_LARGE", "FST_FILES_LIMIT", "FST_PARTS_LIMIT"].includes(String((error as { code?: unknown }).code));
}

function sendMediaError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError || error instanceof MediaStorageError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "MEDIA_REQUEST_FAILED", message: "The image request could not be completed." });
}
