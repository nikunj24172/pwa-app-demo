import type { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { WebAuthnCredential } from "@/lib/models/WebAuthnCredential";
import { storeChallenge, rpFromRequest } from "@/lib/webauthn";
import { json, error } from "@/lib/api";

/** Optional biometric unlock — request assertion options for an email. */
export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  if (!email) return error("Enter your email first.");

  await connectDB();
  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user) return error("No biometric is enrolled for this account.", 404);

  const creds = await WebAuthnCredential.find({ userId: user._id });
  if (creds.length === 0) {
    return error("No biometric is enrolled for this account.", 404);
  }

  const { rpID } = rpFromRequest(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required", // force the fingerprint/face (or PIN) prompt
    allowCredentials: creds.map((c) => ({
      id: c.credentialID,
      transports: c.transports as AuthenticatorTransport[],
    })),
  });

  await storeChallenge(options.challenge, user._id.toString());
  return json(options);
}
