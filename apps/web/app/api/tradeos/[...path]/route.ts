import { NextRequest, NextResponse } from "next/server";
import { forwardAuthenticated } from "../../../lib/session-proxy";

export const dynamic = "force-dynamic";

const exactAllowedPaths = new Set([
  "v1/onboarding/business",
  "v1/catalog/items",
]);
const businessContextPattern = /^v1\/businesses\/[0-9a-f-]{36}\/context$/i;

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  return forwardAllowed(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  return forwardAllowed(request, context);
}

async function forwardAllowed(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const normalized = path.join("/");
  if (!exactAllowedPaths.has(normalized) && !businessContextPattern.test(normalized)) {
    return NextResponse.json({ error: "ROUTE_NOT_ALLOWED", message: "This TradeOS web route is not exposed." }, { status: 404 });
  }

  return forwardAuthenticated(request, `/${normalized}${request.nextUrl.search}`);
}
