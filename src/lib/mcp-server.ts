import fs from "fs/promises";
import path from "path";

import { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import { configDir } from "./paths.js";
import { makeTrelloApiRequest } from "./trello.js";

interface TrelloMcpServerOptions {
  resolveAgentId: (ctx: ServerContext) => Promise<string | undefined> | string | undefined;
}

function createServer() {
  return new McpServer({
    name: "Trello Agent MCP",
    version: "0.1.0",
  }, {
    capabilities: {
      resources: {},
      logging: {},
    },
  });
}

function textResult(text: string, isError = false) {
  return {
    isError,
    content: [{
      type: "text" as const,
      text,
    }],
  };
}

async function requireAgentId(options: TrelloMcpServerOptions, ctx: ServerContext) {
  const agentId = await options.resolveAgentId(ctx);
  if (!agentId) {
    throw new Error("Unable to determine MCP agent id");
  }
  return agentId;
}

const setupInstructionsPath = path.join(configDir, "workspace_setup_instructions.json");
function getSetupInstructions() {
  return fs.readFile(setupInstructionsPath, "utf-8")
    .then(contents => JSON.parse(contents))
    .catch(() => ({}));
}

export function createTrelloMcpServer(options: TrelloMcpServerOptions) {
  const server = createServer();

  server.registerTool("trello-api", {
    description: "Tool for interacting with Trello boards, lists, and cards.",
    inputSchema: z.object({
      endpoint: z.string(),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]),
      body: z.record(z.string(), z.any()).optional(),
    }),
  }, async (input, ctx) => {
    let agentId: string;
    try {
      agentId = await requireAgentId(options, ctx);
    } catch (err) {
      return textResult(`Unauthorized: ${err}`, true);
    }

    try {
      const response = await makeTrelloApiRequest({
        method: input.method,
        endpoint: input.endpoint,
        body: input.body,
        clientIdentifier: `TrelloAgent/mcp/thread/${agentId}`,
      });

      return {
        isError: false,
        content: [{
          type: "resource" as const,
          resource: {
            uri: "trello-api-response.json",
            mimeType: "application/json",
            text: JSON.stringify(response),
          },
        }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{
          type: "text" as const,
          text: "Failed to make Trello API request",
        }, {
          type: "text" as const,
          text: `Error: ${err}`,
        }],
      };
    }
  });

  server.registerResource("workspace_setup_instructions",
    "trello-agent://workspace_setup_instructions.json",
    {
      title: "Workspace Setup Instructions",
      description: "Instructions for setting up the workspace for a new thread.",
    },
    async (uri) => {
      const instructions = await getSetupInstructions();

      instructions.__SYSTEM_INSTRUCTIONS__ = [
        "Never assume. If you are unsure how to set up your workspace, ask. Then use the `set_workspace_setup_instructions` tool to write the instructions you receive for future reference. Unless otherwise specified, setup instructions are specific to the Trello board that the thread is associated with.",
        "If you need to clone a repository, do not use `git clone` directly. Always use the `git_clone` tool. If the clone fails due to authentication issues, do not attempt to find a workaround, instead report the blocker immediately.",
        "Once a repository is cloned, immediately read the instructions in TRELLO_AGENT.md, AGENTS.md and similar documentation within the repository and commit to follow them.",
      ].join("\n");

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(instructions),
        }],
      };
    },
  );

  server.registerTool("set_workspace_setup_instructions", {
    description: "Tool for writing the contents of the workspace setup instructions resource.",
    inputSchema: z.object({
      key: z.string(),
      text: z.string(),
    }),
  }, async (input) => {
    const { key, text } = input;
    if (key.startsWith("__") || key.endsWith("__")) {
      return textResult("Keys starting and ending with \"__\" are reserved and cannot be modified.", true);
    }

    const instructions = await getSetupInstructions();
    instructions[key] = text;
    await fs.writeFile(setupInstructionsPath, JSON.stringify(instructions));

    return textResult("Workspace setup instructions updated successfully");
  });

  return server;
}
