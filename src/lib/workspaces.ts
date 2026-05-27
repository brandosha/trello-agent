import fs from "fs/promises";

import { reposDir } from "./paths.js";
import { execFile } from "./utils.js";


function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9\-]/g, "-");
}

export function getRepoDir(repoLocation: string) {
  let repoHost: string;
  let repoPath: string;
  if (repoLocation.includes("://")) { // URL
    const url = new URL(repoLocation);
    repoHost = url.hostname;
    repoPath = url.pathname.slice(1); // Remove leading slash
  } else if (repoLocation.includes("@")) { // SSH
    const hostAndPath = repoLocation.split("@", 2)[1];
    const [host, path] = hostAndPath.split(":", 2);
    repoHost = host;
    repoPath = path;
  } else {
    throw new Error("Unsupported repository location format");
  }
  
  repoHost = sanitizeFilename(repoHost);
  repoPath = sanitizeFilename(repoPath);
  const workspaceName = `${repoHost}_${repoPath}`;

  return `${reposDir}/${workspaceName}`;
}

export async function cloneRepo(repoLocation: string) {
  const repoDir = getRepoDir(repoLocation);
  await fs.mkdir(repoDir, { recursive: true });

  const bareRepoDir = `${repoDir}/.bare`;
  await execFile('git', ['clone', '--bare', repoLocation, bareRepoDir]);
  await execFile('git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], { cwd: bareRepoDir });
}

interface AddWorktreeParams {
  location: string;
  repo: string;
  branch: string;
}
export async function addDetachedGitWorktree({ location, repo, branch }: AddWorktreeParams) {
  const repoDir = getRepoDir(repo);
  const bareRepoDir = `${repoDir}/.bare`;

  const bareDirStats = await fs.stat(bareRepoDir).catch(() => null);
  if (!bareDirStats || !bareDirStats.isDirectory()) {
    await cloneRepo(repo);
  }

  await execFile('git', ['fetch', 'origin', branch], { cwd: bareRepoDir });
  await execFile('git', ['worktree', 'add', '--detach', location, `origin/${branch}`], { cwd: bareRepoDir });
  await execFile('git', ['config', 'user.name', 'trello-agent'], { cwd: location });
}
