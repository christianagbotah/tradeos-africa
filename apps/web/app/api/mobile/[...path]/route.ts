import { NextRequest, NextResponse } from "next/server";
import { forwardNativeApi, isNativeApiRouteAllowed } from "../../../lib/native-api-proxy";

export const dynamic = "force-dynamic";

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
  if (!isNativeApiRouteAllowed(request.method, normalized)) {
    return NextResponse.json(
      { error: "ROUTE_NOT_ALLOWED", message: "This TradeOS mobile route is not exposed." },
      { status: 404 },
    );
  }

  return forwardNativeApi(request, `/${normalized}${request.nextUrl.search}`);
}