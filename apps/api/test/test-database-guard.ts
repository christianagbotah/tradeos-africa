const DEFAULT_TEST_DATABASE_URL = "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const SAFE_DATABASE_NAME = /(?:^|[_-])(?:ci|test|qa)(?:$|[_-])/i;

export function assertSafeTestDatabaseUrl(rawUrl = process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL): string {
  const databaseName = extractDatabaseName(rawUrl);
  if (!databaseName || !SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Refusing destructive API tests against database "${databaseName || "unknown"}". Use a dedicated CI/test/QA database.`,
    );
  }
  return rawUrl;
}

export function installTestDatabaseGuard(): void {
  process.env.DATABASE_URL = assertSafeTestDatabaseUrl();
}

function extractDatabaseName(rawUrl: string): string {
  const withoutFragment = rawUrl.split("#", 1)[0] ?? "";
  const withoutQuery = withoutFragment.split("?", 1)[0] ?? "";
  const slash = withoutQuery.lastIndexOf("/");
  if (slash < 0 || slash === withoutQuery.length - 1) return "";
  try {
    return decodeURIComponent(withoutQuery.slice(slash + 1));
  } catch {
    return "";
  }
}
