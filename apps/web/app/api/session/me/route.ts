import { NextRequest } from "next/server";
import { forwardAuthenticated } from "../../../lib/session-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return forwardAuthenticated(request, "/v1/me");
}
