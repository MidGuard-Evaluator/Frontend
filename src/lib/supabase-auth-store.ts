import { decryptAES256, encryptAES256, hashPassword, verifyPassword } from "./server-crypto";
import type { SessionUser, UserRole } from "./types";

type SupabaseUserRow = {
  user_id: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
  display_name: string;
  encrypted_student_id?: string | null;
  encrypted_pseudonym?: string | null;
  is_active: boolean;
};

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

/**
 * Authenticates a user strictly against Supabase PostgreSQL (public.app_users) over HTTPS/TLS.
 * Zero hardcoded credentials: all user records live in Supabase.
 */
export async function authenticateWithSupabase(
  identifier: string,
  password: string,
  expectedRole: UserRole,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in SYSTEM/frontend/.env.",
    };
  }

  const cleanId = identifier.trim().toLowerCase();
  const queryUrl = `${cfg.url}/rest/v1/app_users?or=(username.ilike.${encodeURIComponent(
    cleanId,
  )},email.ilike.${encodeURIComponent(cleanId)})&is_active=eq.true&select=*`;

  let res: Response;
  try {
    res = await fetch(queryUrl, {
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
      },
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach Supabase over HTTPS. Check NEXT_PUBLIC_SUPABASE_URL in .env.",
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Supabase query failed (${res.status}). Ensure migration 001_supabase_auth_and_rls.sql has been executed in Supabase SQL Editor. ${errText.slice(0, 120)}`,
    };
  }

  const rows = (await res.json()) as SupabaseUserRow[];
  const row = rows[0];

  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, error: "Invalid username or password." };
  }

  if (row.role !== expectedRole) {
    return {
      ok: false,
      error: `Account '${row.username}' belongs to role ${row.role}, not ${expectedRole}.`,
    };
  }

  let studentId: string | undefined;
  let pseudonymousCode: string | undefined;
  try {
    if (row.encrypted_student_id) studentId = decryptAES256(row.encrypted_student_id);
    if (row.encrypted_pseudonym) pseudonymousCode = decryptAES256(row.encrypted_pseudonym);
  } catch {
    return {
      ok: false,
      error: "Failed to decrypt AES-256 identity attributes. Check DATA_AES256_KEY in .env.",
    };
  }

  return {
    ok: true,
    user: {
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      studentId,
      pseudonymousCode,
    },
  };
}

/**
 * Registers a new user directly into Supabase PostgreSQL (public.app_users)
 * with PBKDF2-HMAC-SHA256 password hashing and AES-256-GCM encryption for student IDs.
 */
export async function registerUserInSupabase(input: {
  username: string;
  email: string;
  password: string;
  role: UserRole;
  displayName: string;
  studentId?: string;
  pseudonymousCode?: string;
}): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    return {
      ok: false,
      error:
        "Supabase is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in SYSTEM/frontend/.env.",
    };
  }

  const passwordHash = hashPassword(input.password);
  const encryptedStudentId = input.studentId ? encryptAES256(input.studentId.trim()) : null;
  const encryptedPseudonym = input.pseudonymousCode
    ? encryptAES256(input.pseudonymousCode.trim())
    : null;

  const res = await fetch(`${cfg.url}/rest/v1/app_users`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      username: input.username.trim(),
      email: input.email.trim().toLowerCase(),
      password_hash: passwordHash,
      role: input.role,
      display_name: input.displayName.trim() || input.username.trim(),
      encrypted_student_id: encryptedStudentId,
      encrypted_pseudonym: encryptedPseudonym,
      is_active: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `Could not create user in Supabase (${res.status}): ${detail.slice(0, 140)}`,
    };
  }

  // If student identity mapping provided, store encrypted mapping in student_identity_map (NFR-02)
  if (input.role === "STUDENT" && encryptedStudentId && input.pseudonymousCode) {
    await fetch(`${cfg.url}/rest/v1/student_identity_map`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assessment_id: "asm-cs2042-mid-2026",
        pseudonymous_script_code: input.pseudonymousCode.trim(),
        encrypted_real_student_id: encryptedStudentId,
      }),
    }).catch(() => undefined);
  }

  return {
    ok: true,
    user: {
      username: input.username.trim(),
      displayName: input.displayName.trim() || input.username.trim(),
      role: input.role,
      studentId: input.studentId?.trim(),
      pseudonymousCode: input.pseudonymousCode?.trim(),
    },
  };
}
