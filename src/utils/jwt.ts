/**
 * Read the `exp` claim (seconds since epoch) from a JWT without verifying it.
 * Returns null if the token is malformed or has no `exp`.
 */
export function getJwtExpiry(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), "=");

    const json =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf-8");

    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Whether a JWT is expired (or expires within `skewSeconds`).
 * Tokens without a readable `exp` are treated as not expired.
 */
export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const exp = getJwtExpiry(token);
  if (exp === null) return false;
  return Date.now() / 1000 >= exp - skewSeconds;
}
