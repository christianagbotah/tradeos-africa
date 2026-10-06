import { NextRequest } from "next/server";
import { openSession } from "../../../lib/session-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return openSession(request, "/v1/auth/register");
}
