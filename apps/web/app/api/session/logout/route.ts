import { NextRequest } from "next/server";
import { closeSession } from "../../../lib/session-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return closeSession(request);
}
