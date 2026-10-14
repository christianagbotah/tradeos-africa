import type { BusinessAccess } from "../auth/authorization.js";
import { requireBusinessRole } from "../auth/authorization.js";
import { AuthError, type AuthContext } from "../auth/security.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import {
  type ManagedImageMime,
  type ManagedImagePurpose,
  type StoredImage,
  readStoredImage,
  removeStoredImage,
  storeImage,
} from "./media-storage.js";

const BUSINESS_MEDIA_ROLES = ["OWNER", "ADMIN"] as const;

export interface UploadedImageInput {
  bytes: Buffer;
  declaredMime: string;
}

export interface ManagedMediaView {
  id: string;
  url: string;
  mimeType: ManagedImageMime;
  sizeBytes: number;
}

export interface ManagedMediaContent {
  id: string;
  mimeType: ManagedImageMime;
  sizeBytes: number;
  bytes: Buffer;
}

type RetiredMedia = { storage_name: string };
type MediaRow = {
  id: string;
  mime_type: ManagedImageMime;
  size_bytes: string | number;
  storage_name: string;
};

export async function replaceAvatar(
  pool: DatabasePool,
  auth: AuthContext,
  upload: UploadedImageInput,
): Promise<ManagedMediaView> {
  const stored = await storeImage({ ...upload, purpose: "AVATAR" });
  let oldFiles: RetiredMedia[] = [];
  try {
    const media = await withTransaction(pool, async (client) => {
      await client.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [auth.userId]);
      oldFiles = await retireMedia(client, "AVATAR", "owner_user_id", auth.userId);
      const inserted = await insertMedia(client, stored, "AVATAR", auth.userId, null, auth.userId);
      const url = mediaUrl(inserted.id);
      await client.query("UPDATE app_users SET avatar_url=$2,updated_at=now() WHERE id=$1", [auth.userId, url]);
      await client.query(
        "INSERT INTO account_security_events(user_id,event_type,payload) VALUES($1,'PROFILE_AVATAR_UPDATED',$2::jsonb)",
        [auth.userId, JSON.stringify({ mediaId: inserted.id, mimeType: inserted.mime_type, sizeBytes: Number(inserted.size_bytes) })],
      );
      return mapMedia(inserted);
    });
    await cleanupRetired(oldFiles);
    return media;
  } catch (error) {
    await removeStoredImage(stored.storageName).catch(() => undefined);
    throw error;
  }
}

export async function removeAvatar(pool: DatabasePool, auth: AuthContext): Promise<void> {
  let oldFiles: RetiredMedia[] = [];
  await withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM app_users WHERE id=$1 FOR UPDATE", [auth.userId]);
    oldFiles = await retireMedia(client, "AVATAR", "owner_user_id", auth.userId);
    await client.query("UPDATE app_users SET avatar_url=NULL,updated_at=now() WHERE id=$1", [auth.userId]);
    await client.query(
      "INSERT INTO account_security_events(user_id,event_type,payload) VALUES($1,'PROFILE_AVATAR_REMOVED',$2::jsonb)",
      [auth.userId, JSON.stringify({ hadManagedAvatar: oldFiles.length > 0 })],
    );
  });
  await cleanupRetired(oldFiles);
}

export async function replaceBusinessLogo(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
  upload: UploadedImageInput,
): Promise<ManagedMediaView> {
  const access = await requireBusinessMediaAccess(pool, auth, businessId);
  const stored = await storeImage({ ...upload, purpose: "BUSINESS_LOGO" });
  let oldFiles: RetiredMedia[] = [];
  try {
    const media = await withTransaction(pool, async (client) => {
      await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [businessId]);
      oldFiles = await retireMedia(client, "BUSINESS_LOGO", "business_id", businessId);
      const inserted = await insertMedia(client, stored, "BUSINESS_LOGO", null, businessId, auth.userId);
      const url = mediaUrl(inserted.id);
      await client.query("UPDATE businesses SET logo_url=$2,updated_at=now() WHERE id=$1", [businessId, url]);
      await writeBusinessMediaAudit(client, access, "BUSINESS_LOGO_UPDATED", inserted.id, {
        mimeType: inserted.mime_type,
        sizeBytes: Number(inserted.size_bytes),
      });
      return mapMedia(inserted);
    });
    await cleanupRetired(oldFiles);
    return media;
  } catch (error) {
    await removeStoredImage(stored.storageName).catch(() => undefined);
    throw error;
  }
}

export async function removeBusinessLogo(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
): Promise<void> {
  const access = await requireBusinessMediaAccess(pool, auth, businessId);
  let oldFiles: RetiredMedia[] = [];
  await withTransaction(pool, async (client) => {
    await client.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [businessId]);
    oldFiles = await retireMedia(client, "BUSINESS_LOGO", "business_id", businessId);
    await client.query("UPDATE businesses SET logo_url=NULL,updated_at=now() WHERE id=$1", [businessId]);
    await writeBusinessMediaAudit(client, access, "BUSINESS_LOGO_REMOVED", businessId, {
      hadManagedLogo: oldFiles.length > 0,
    });
  });
  await cleanupRetired(oldFiles);
}

export async function loadManagedMedia(pool: DatabasePool, mediaId: string): Promise<ManagedMediaContent | null> {
  const result = await pool.query<MediaRow>(
    `SELECT id,mime_type,size_bytes,storage_name
     FROM managed_media
     WHERE id=$1 AND retired_at IS NULL`,
    [mediaId],
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    return {
      id: row.id,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      bytes: await readStoredImage(row.storage_name),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

async function requireBusinessMediaAccess(
  pool: DatabasePool,
  auth: AuthContext,
  businessId: string,
): Promise<BusinessAccess & { staffId: string }> {
  const access = await requireBusinessRole(pool, auth, businessId, BUSINESS_MEDIA_ROLES);
  if (!access.staffId) {
    throw new AuthError("Your business membership is not linked to an active staff actor", 403, "STAFF_ACTOR_REQUIRED");
  }
  return access as BusinessAccess & { staffId: string };
}

async function retireMedia(
  client: DatabaseClient,
  purpose: ManagedImagePurpose,
  ownerColumn: "owner_user_id" | "business_id",
  ownerId: string,
): Promise<RetiredMedia[]> {
  const result = await client.query<RetiredMedia>(
    `UPDATE managed_media
     SET retired_at=now()
     WHERE purpose=$1 AND ${ownerColumn}=$2 AND retired_at IS NULL
     RETURNING storage_name`,
    [purpose, ownerId],
  );
  return result.rows;
}

async function insertMedia(
  client: DatabaseClient,
  stored: StoredImage,
  purpose: ManagedImagePurpose,
  ownerUserId: string | null,
  businessId: string | null,
  createdByUserId: string,
): Promise<MediaRow> {
  const result = await client.query<MediaRow>(
    `INSERT INTO managed_media(
       purpose,owner_user_id,business_id,created_by_user_id,mime_type,size_bytes,storage_name
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,mime_type,size_bytes,storage_name`,
    [purpose, ownerUserId, businessId, createdByUserId, stored.mimeType, stored.sizeBytes, stored.storageName],
  );
  return result.rows[0]!;
}

async function writeBusinessMediaAudit(
  client: DatabaseClient,
  access: BusinessAccess & { staffId: string },
  eventType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES($1,$2,$3,'BUSINESS',$4,$5::jsonb)`,
    [access.businessId, access.staffId, eventType, entityId, JSON.stringify(payload)],
  );
}

async function cleanupRetired(rows: RetiredMedia[]): Promise<void> {
  await Promise.all(rows.map((row) => removeStoredImage(row.storage_name).catch(() => undefined)));
}

function mediaUrl(id: string): string {
  return `/v1/media/${id}`;
}

function mapMedia(row: MediaRow): ManagedMediaView {
  return { id: row.id, url: mediaUrl(row.id), mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) };
}
