import path from "path";
import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";

function getRootDir() {
  let currentDir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(currentDir, "package.json"))) {
      return path.resolve(currentDir);
    }
    currentDir = path.join(currentDir, "..");
  }

  throw new Error("Could not find root directory containing package.json");
}


export const rootDir = getRootDir();
export const dataDir = path.join(rootDir, "data");
export const configDir = path.join(dataDir, "config");
export const threadsDir = path.join(dataDir, "threads");
export const reposDir = `${dataDir}/repos`;

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

if (!existsSync(threadsDir)) {
  mkdirSync(threadsDir, { recursive: true });
}

// export const mkConfigDir = fs.mkdir(configDir, { recursive: true });