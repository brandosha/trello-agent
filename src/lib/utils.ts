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

export function multilineString(...lines: (string | boolean)[]) {
  return lines.filter((l) => typeof l === "string").join("\n");
}
