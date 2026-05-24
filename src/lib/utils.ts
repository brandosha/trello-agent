import cp from "child_process";
import { readFileSync } from "fs";
import os from "os";
import { promisify } from "util";

export const execFile = promisify(cp.execFile);

export function randomStr(length: number = 8) {
  let chars = "abcdefghijklmnopqrstuvwxyz";
  chars += chars.toUpperCase() + "0123456789";

  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Checks if the current operating system is Ubuntu.
 */
export function isUbuntu(): boolean {
  // Fast fail if it's not even Linux
  if (os.platform() !== 'linux') {
    return false;
  }

  try {
    // Read the standard Linux release info file
    const osRelease = readFileSync('/etc/os-release', 'utf8');
    
    // Look for the standard Ubuntu identifier
    // We check for exactly "ID=ubuntu" to avoid matching strings in descriptions
    return osRelease.split('\n').some(line => line.trim() === 'ID=ubuntu');
  } catch (error) {
    // If the file doesn't exist or can't be read, default to false
    return false;
  }
}