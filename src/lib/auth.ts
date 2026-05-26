import { SignJWT, jwtVerify, generateSecret, JWTPayload, exportJWK, importJWK } from "jose";

import { getConfigValue, setConfigValue } from "./database.js";

interface AuthPayload extends JWTPayload {
  email: string;
}

const JWT_ALG = "HS256";

const symmetricKey = (async () => {
  const json = getConfigValue("jwt.secret");
  try {
    const jwk = JSON.parse(json ?? "");
    return await importJWK(jwk, JWT_ALG);
  } catch (err: any) {
    const newKey = await generateSecret(JWT_ALG, {
      extractable: true,
    }) as CryptoKey;
    const jwk = await exportJWK(newKey);
    setConfigValue("jwt.secret", JSON.stringify(jwk));
    return newKey;
  }
})();

export async function generateAuthToken(payload: AuthPayload, expiresIn: string = "2w") {
  const privateKey = await symmetricKey;

  const alg = JWT_ALG;
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg })
    .setExpirationTime(expiresIn)
    .sign(privateKey);

  return jwt;
}

export async function verifyAuthToken(token: string) {
  const privateKey = await symmetricKey;
  const jwt = await jwtVerify(token, privateKey);
  return jwt.payload;
}