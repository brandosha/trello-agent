import cp from "child_process";
import fs from "fs/promises";
import { promisify } from "util";

import { dataDir } from "./paths.js";


const execFile = promisify(cp.execFile);

const workspacesDir = `${dataDir}/workspaces`;

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

  return `${workspacesDir}/${workspaceName}`;
}

export async function cloneRepo(repoLocation: string) {
  const repoDir = getRepoDir(repoLocation);
  await fs.mkdir(repoDir, { recursive: true });

  const bareRepoDir = `${repoDir}/.bare`;
  await execFile('git', ['clone', '--bare', repoLocation, bareRepoDir]);
  await execFile('git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], { cwd: bareRepoDir });
}

interface SetupWorkspaceParams {
  workspaceId: string;
  repo: string;
  mainBranch: string;
}

export async function setupWorkspace({ repo, workspaceId, mainBranch }: SetupWorkspaceParams) {
  const repoDir = getRepoDir(repo);
  const bareRepoDir = `${repoDir}/.bare`;

  const bareDirStats = await fs.stat(bareRepoDir).catch(() => null);
  if (!bareDirStats || !bareDirStats.isDirectory()) {
    await cloneRepo(repo);
  }

  const workspaceDir = `${repoDir}/${workspaceId}`;
  try {
    await fs.access(workspaceDir, fs.constants.F_OK);
    return workspaceDir; // Workspace already exists
  } catch {
    // Workspace doesn't exist, continue with setup
  }

  await execFile('git', ['fetch', 'origin', mainBranch], { cwd: bareRepoDir });
  await execFile('git', ['worktree', 'add', workspaceDir, `origin/${mainBranch}`], { cwd: bareRepoDir });

  return workspaceDir;
}