import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const apiBase = (process.env.TRADEOS_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

  try {
    const body = await request.text();
    const response = await fetch(`${apiBase}/v1/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
    const responseBody = await response.text();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: "SYNC_API_UNAVAILABLE", message: "The TradeOS transaction API could not be reached." },
      { status: 503 },
    );
  }
}
