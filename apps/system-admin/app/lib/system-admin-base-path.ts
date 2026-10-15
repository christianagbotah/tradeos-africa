export const SYSTEM_ADMIN_BASE_PATH = "/system-admin" as const;

export function withSystemAdminBasePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("System Admin paths must be absolute app paths");
  }
  return `${SYSTEM_ADMIN_BASE_PATH}${path}`;
}
