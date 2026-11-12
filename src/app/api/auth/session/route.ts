import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionJwt } from "@/lib/server-crypto";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = verifySessionJwt(token);
  if (!user) {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }
  return NextResponse.json({ authenticated: true, user }, { status: 200 });
}

