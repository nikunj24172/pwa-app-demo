import type { NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { WebAuthnCredential } from "@/lib/models/WebAuthnCredential";
import { signSession, setSessionCookie, clearAuthCookies } from "@/lib/auth";
import { readChallenge, clearChallenge, rpFromRequest } from "@/lib/webauthn";
import { json, error } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const response = body?.response ?? body;
  const location = body?.location;
  if (!response?.id) return error("Invalid payload");

  const stored = await readChallenge();
  if (!stored) return error("Challenge expired. Try again.", 400);

  await connectDB();
  const cred = await WebAuthnCredential.findOne({ credentialID: response.id });
  if (!cred) return error("Unknown credential.", 404);

  let verification;
  try {
    const { rpID, origin } = rpFromRequest(req);
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialID,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransport[],
      },
    });
  } catch (e) {
    return error((e as Error).message, 400);
  }

  if (!verification.verified) return error("Biometric verification failed.", 401);

  cred.counter = verification.authenticationInfo.newCounter; // replay protection
  await cred.save();

  const user = await User.findById(cred.userId);
  if (!user) return error("User not found.", 404);

  const permissions = user.permissions.map((p) => String(p));
  const token = await signSession({
    sub: user._id.toString(),
    username: user.username,
    name: user.name,
    role: user.role,
    permissions,
    amr: ["webauthn"],
  });
  await clearAuthCookies();
  await clearChallenge();
  await setSessionCookie(token);

  await writeAudit(req, { userId: user._id.toString(), username: user.username }, {
    action: "login",
    location: typeof location === "string" ? location : undefined,
  });

  return json({
    status: "authenticated",
    user: {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role,
      permissions,
    },
  });
}
