import fs from "fs/promises";

import { configDir, mkConfigDir } from "./paths.js";

import { SignJWT, jwtVerify, generateSecret, JWTPayload, exportJWK, importJWK } from "jose";

interface AuthPayload extends JWTPayload {
  email: string;
}

const JWT_ALG = "HS256";

const symmetricKey = (async () => {
  await mkConfigDir;
  const keyPath = `${configDir}/jwt_secret.json`;

  try {
    const raw = await fs.readFile(keyPath, "utf-8");
    const jwk = JSON.parse(raw);
    return await importJWK(jwk, JWT_ALG);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      const newKey = await generateSecret(JWT_ALG, {
        extractable: true,
      }) as CryptoKey;
      const jwk = await exportJWK(newKey);
      await fs.writeFile(keyPath, JSON.stringify(jwk));
      return newKey;
    }
    throw err;
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