import { createPool } from "../db.js";
import { provisionPlatformAdmin } from "../platform-admin/provision.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const pool = createPool();
try {
  const admin = await provisionPlatformAdmin(pool, {
    email: required("PLATFORM_ADMIN_EMAIL"),
    displayName: required("PLATFORM_ADMIN_DISPLAY_NAME"),
    role: required("PLATFORM_ADMIN_ROLE"),
    password: required("PLATFORM_ADMIN_PASSWORD"),
  });
  console.log(`Provisioned platform administrator ${admin.email} (${admin.role}).`);
} finally {
  await pool.end();
}
