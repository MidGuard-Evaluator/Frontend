import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { JWT_TTL_SECONDS, SESSION_COOKIE_NAME, signSessionJwt } from "@/lib/server-crypto";
import { registerUserInSupabase } from "@/lib/supabase-auth-store";
import type { UserRole } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      username?: string;
      email?: string;
      password?: string;
      role?: UserRole;
      displayName?: string;
      studentId?: string;
      pseudonymousCode?: string;
    };

    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    const role: UserRole = body.role === "STUDENT" ? "STUDENT" : "TEACHER";
    const email = body.email?.trim() || `${username.toLowerCase()}@uom.lk`;
    const displayName = body.displayName?.trim() || username;

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400 },
      );
    }

    const result = await registerUserInSupabase({
      username,
      email,
      password,
      role,
      displayName,
      studentId: role === "STUDENT" ? body.studentId?.trim() || username : undefined,
      pseudonymousCode: body.pseudonymousCode?.trim(),
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    const token = signSessionJwt(result.user);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: JWT_TTL_SECONDS,
    });

    return NextResponse.json({ ok: true, user: result.user });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Registration service error." },
      { status: 500 },
    );
  }
}

