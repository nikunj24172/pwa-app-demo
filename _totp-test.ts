import { generateSecret, generateURI, generateSync, verify } from "otplib";

const secret = generateSecret();
const uri = generateURI({ issuer: "InfoLog Mobile", label: "test@x.com", secret });
const token = generateSync({ secret });

(async () => {
  const good = await verify({ secret, token });
  const withTol = await verify({ secret, token, epochTolerance: 30 });
  console.log("secret:", secret);
  console.log("uri   :", uri);
  console.log("token :", token, "(len " + token.length + ")");
  console.log("verify(no opts) :", JSON.stringify(good));
  console.log("verify(tol=30)  :", JSON.stringify(withTol));
})();
