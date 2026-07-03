import { generateRegistrationOptions } from "@simplewebauthn/server";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/User";
import { WebAuthnCredential } from "@/lib/models/WebAuthnCredential";
import { getSession } from "@/lib/auth";
import { rpID, rpName, storeChallenge } from "@/lib/webauthn";
import { json, error } from "@/lib/api";

/** Optional biometric enrollment — requires an authenticated session. */
export async function POST() {
  const session = await getSession();
  if (!session) return error("Not authenticated", 401);

  await connectDB();
  const user = await User.findById(session.sub);
  if (!user) return error("User not found", 404);

  const existing = await WebAuthnCredential.find({ userId: user._id });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(user._id.toString()),
    userName: user.username,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialID,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required", // force the fingerprint/face (or PIN) prompt
      // no attachment restriction → phone / other device passkeys allowed too
    },
  });

  await storeChallenge(options.challenge, user._id.toString());
  return json(options);
}
