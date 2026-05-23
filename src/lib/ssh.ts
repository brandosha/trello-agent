import fs from "fs/promises";
import os from "os";
import path from "path";

import { execFile } from "./utils.js";

export async function getPublicKey() {
  const sshDir = path.join(os.homedir(), ".ssh");
  const keyPath = path.join(sshDir, "id_ed25519");
  const pubKeyPath = path.join(sshDir, "id_ed25519.pub");

  try {
    const publicKey = await fs.readFile(pubKeyPath, "utf-8");
    if (publicKey) {
      return publicKey;
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
    console.error("SSH key not found, generating new keys...");
  }

  // If we couldn't read the keys, generate a new pair
  await fs.mkdir(sshDir, { recursive: true });
  await Promise.all([
    fs.rm(keyPath), fs.rm(pubKeyPath)
  ]).catch(() => null); // Ignore errors if files don't exist

  await execFile("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-C", "trello-agent", "-N", ""]);

  const publicKey = await fs.readFile(pubKeyPath, "utf-8");
  return publicKey;
}
