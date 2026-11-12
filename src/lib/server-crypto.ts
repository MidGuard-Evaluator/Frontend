import crypto from "crypto";
import type { SessionUser, UserRole } from "./types";

// Server-side cryptographic secrets loaded strictly from .env (NFR-02: never exposed to client bundles)
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "";
const AES_KEY = crypto
  .createHash("sha256")
  .update(process.env.DATA_AES256_KEY || "")
  .digest(); // 32 bytes = 256 bits

export const SESSION_COOKIE_NAME = "ese_session_jwt";
export const JWT_TTL_SECONDS = 60 * 60; // Short-lived 1-hour JWT per Section 4.4

/**
 * Encrypts sensitive plaintext (such as student identity mappings or stored credentials)
 * using AES-256-GCM with a random 96-bit IV and 128-bit authentication tag (NFR-02).
 */
export function encryptAES256(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts an AES-256-GCM payload and verifies its authentication tag.
 */
export function decryptAES256(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid AES-256-GCM ciphertext format");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Hashes a user password with PBKDF2-HMAC-SHA256 (100,000 iterations) and a 128-bit random salt.
 */
export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  return `pbkdf2_sha256$100000$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifies a plaintext password against a stored PBKDF2-SHA256 hash using timing-safe comparison.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const [, , saltHex, expectedHex] = parts;
  const candidate = hashPassword(password, saltHex).split("$")[3];
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(expectedHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type JwtClaims = {
  sub: string;
  username: string;
  displayName: string;
  role: UserRole;
  studentId?: string;
  pseudonymousCode?: string;
  iat: number;
  exp: number;
  jti: string;
};

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(input: string): string {
  const pad = 4 - (input.length % 4 || 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + (pad < 4 ? "=".repeat(pad) : "");
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Signs a short-lived HS256 JSON Web Token for HttpOnly session cookies.
 */
export function signSessionJwt(user: SessionUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: JwtClaims = {
    sub: user.username,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    studentId: user.studentId,
    pseudonymousCode: user.pseudonymousCode,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    jti: crypto.randomUUID(),
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

/**
 * Verifies an HS256 JWT signature and expiration timestamp.
 */
export function verifySessionJwt(token?: string): SessionUser | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expectedSig = base64UrlEncode(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(base64UrlDecode(payload)) as JwtClaims;
    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) return null;
    return {
      username: claims.username,
      displayName: claims.displayName,
      role: claims.role,
      studentId: claims.studentId,
      pseudonymousCode: claims.pseudonymousCode,
    };
  } catch {
    return null;
  }
}

