import type { NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { connectDB } from "@/lib/db";
import { WebAuthnCredential } from "@/lib/models/WebAuthnCredential";
import { getSession } from "@/lib/auth";
import { readChallenge, clearChallenge, rpFromRequest } from "@/lib/webauthn";
import { json, error } from "@/lib/api";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return error("Not authenticated", 401);

  const body = await req.json().catch(() => null);
  if (!body) return error("Invalid payload");

  const stored = await readChallenge();
  if (!stored) return error("Challenge expired. Try again.", 400);

  let verification;
  try {
    const { rpID, origin } = rpFromRequest(req);
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (e) {
    return error((e as Error).message, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return error("Biometric registration failed.", 400);
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  await connectDB();
  await WebAuthnCredential.create({
    userId: session.sub,
    credentialID: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
  });
  await clearChallenge();

  return json({ status: "biometric_enrolled" });
}
