import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
} as const;

export async function GET() {
  if (process.env.NODE_ENV !== "production") {
    return Response.json({ buildId: "development" }, { headers: NO_STORE_HEADERS });
  }

  try {
    const buildId = (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
    if (!buildId) {
      return Response.json({ buildId: null }, { status: 503, headers: NO_STORE_HEADERS });
    }
    return Response.json({ buildId }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json({ buildId: null }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
