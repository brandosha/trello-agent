import fs from "fs/promises";

import { execFile } from "./utils.js";

async function getKeypair() {
  const keyPath = `~/.ssh/id_ed25519`;
  const pubKeyPath = `~/.ssh/id_ed25519.pub`;

  try {
    const [privateKey, publicKey] = await Promise.all([
      fs.readFile(keyPath, "utf-8"),
      fs.readFile(pubKeyPath, "utf-8"),
    ]);

    if (privateKey && publicKey) {
      return { privateKey, publicKey };
    }
  } catch (err) {
    console.error("Error reading SSH keypair:", err);
  }

  // If we couldn't read the keys, generate a new pair
  await Promise.all([
    fs.rm(keyPath), fs.rm(pubKeyPath)
  ]).catch(() => null); // Ignore errors if files don't exist

  await execFile("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-C", "trello-agent", "-N", ""]);

  const [privateKey, publicKey] = await Promise.all([
    fs.readFile(keyPath, "utf-8"),
    fs.readFile(pubKeyPath, "utf-8"),
  ]);

  return {
    privateKey,
    publicKey
  };
}

const keypair = getKeypair();

export async function getPublicKey() {
  const { publicKey } = await keypair;
  return publicKey;
}