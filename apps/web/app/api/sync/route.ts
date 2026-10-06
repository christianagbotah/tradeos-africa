import { NextRequest } from "next/server";
import { forwardAuthenticated } from "../../lib/session-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return forwardAuthenticated(request, "/v1/sync");
}
