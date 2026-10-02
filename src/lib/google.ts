import { createRemoteJWKSet, jwtVerify } from "jose";
import { badRequest } from "./http";

// "Continue with Google": checks the ID token the app gets from Google Sign-In.
// GOOGLE_CLIENT_IDS is a comma-separated list of the app's OAuth client IDs
// (the token's audience); without it, Google sign-in is off.
const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type GoogleProfile = { sub: string; email: string | null; name: string };

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const audience = (process.env.GOOGLE_CLIENT_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (audience.length === 0) throw badRequest("Google sign-in isn't available yet.");
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience,
    });
    return {
      sub: String(payload.sub),
      // Only an address Google has verified can be trusted as the customer's.
      email: payload.email_verified === true && typeof payload.email === "string" ? payload.email.toLowerCase() : null,
      name: typeof payload.name === "string" ? payload.name : "",
    };
  } catch {
    throw badRequest("Couldn't sign in with Google. Please try again.");
  }
}
