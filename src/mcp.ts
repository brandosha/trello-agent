import path from "path";

import { StdioServerTransport } from "@modelcontextprotocol/server";

import { createTrelloMcpServer } from "./lib/mcp-server.js";

const server = createTrelloMcpServer({
  enableGitClone: true,
  resolveAgentId: async () => {
    const workingDir = await getWorkingDirectory();
    return path.basename(path.join(workingDir, ".."));
  },
  resolveWorkingDirectory: getWorkingDirectory,
});

async function getWorkingDirectory() {
  const { roots } = await server.server.listRoots();
  if (!roots || roots.length === 0) {
    return process.cwd();
  }

  return roots[0].uri.replace("file:/", "");
}

await server.connect(new StdioServerTransport());
