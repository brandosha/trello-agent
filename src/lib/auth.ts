import { SignJWT, jwtVerify, generateKeyPair, JWTPayload } from "jose";

interface AuthPayload extends JWTPayload {
  email: string;
}

const keypair = generateKeyPair("Ed25519");

export async function generateAuthToken(payload: AuthPayload, expiresIn: string = "2w") {
  const { privateKey } = await keypair;

  const alg = "EdDSA";
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg })
    .setExpirationTime(expiresIn)
    .sign(privateKey);

  return jwt;
}

export async function verifyAuthToken(token: string) {
  const { publicKey } = await keypair;
  const jwt = await jwtVerify(token, publicKey);
  return jwt.payload;
}