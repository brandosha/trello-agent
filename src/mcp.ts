import fs from "fs/promises";
import path from "path";

import { McpServer, ServerContext, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { codex } from './lib/codex.js';
import { threadsDir, configDir } from './lib/paths.js';
import { makeTrelloApiRequest } from './lib/trello.js';
import { addDetachedGitWorktree } from './lib/workspaces.js';


const server = new McpServer({
  name: 'Trello Agent MCP',
  version: '0.1.0',
}, {
  capabilities: {
    resources: {},
    logging: {},
  }
});


server.registerTool("trello-api", {
  description: "Tool for interacting with Trello boards, lists, and cards.",
  inputSchema: z.object({
    endpoint: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
    body: z.record(z.string(), z.any()).optional(),
  }),
}, async (input) => {

  const workingDir = await getWorkingDirectory();
  const threadId = path.basename(path.join(workingDir, ".."));

  try {
    const response = await makeTrelloApiRequest({
      method: input.method,
      endpoint: input.endpoint,
      body: input.body,
      clientIdentifier: `TrelloAgent/mcp/thread/${threadId}`
    });

    return {
      isError: false,
      content: [{
        type: 'resource',
        resource: {
          uri: 'trello-api-response.json',
          mimeType: 'application/json',
          text: JSON.stringify(response),
        }
      }]
    }
  } catch (err) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Failed to make Trello API request'
      }, {
        type: 'text',
        text: `Error: ${err}`
      }]
    }
  }
});


async function getWorkingDirectory() {
  const { roots } = await server.server.listRoots();
  if (!roots || roots.length === 0) {
    return process.cwd();
  }

  return roots[0].uri.replace('file:/', '');
}

async function isManagerThread(context: ServerContext): Promise<boolean> {
  const managerThreadId = 'default';
  const managerWorkspace = `${threadsDir}/${managerThreadId}/workspace`;
  
  const { roots } = await server.server.listRoots();
  if (!roots || roots.length === 0) {
    const cwd = process.cwd();
    return cwd === managerWorkspace;
  }

  return roots.some((root: any) => root.uri === `file://${managerWorkspace}`);
}

// server.registerTool("prompt_thread", {
//   description: "Tool for sending a prompt to a thread. Only the manager thread is authorized to use this tool.",
//   inputSchema: z.object({
//     threadId: z.string(),
//     prompt: z.string(),
//   })
// }, async (input, context) => {
//   const isManager = await isManagerThread(context);
//   if (!isManager) {
//     return {
//       isError: true,
//       content: [{
//         type: 'text',
//         text: 'Unauthorized: prompt_thread tool can only be used by the manager thread'
//       }]
//     };
//   }

//   if (!codex.threadExists(input.threadId)) {
//     return {
//       isError: true,
//       content: [{
//         type: 'text',
//         text: `Thread with ID ${input.threadId} does not exist`
//       }]
//     };
//   }

//   const thread = codex.thread(input.threadId);
//   thread.queueInput(input.prompt, 'system/mcp/prompt_thread');

//   return {
//     isError: false,
//     content: [{
//       type: 'text',
//       text: `Prompt sent to thread ${input.threadId}`
//     }]
//   };
// });

// server.registerTool("setup_thread_workspace", {
//   description: "Tool for setting up git worktree for a thread. Only the manager thread is authorized to use this tool. Always prefer ssh git URLs.",
//   inputSchema: z.object({
//     threadId: z.string(),
//     gitRepo: z.string(),
//   })
// }, async (input, context) => {
//   const isManager = await isManagerThread(context);
//   if (!isManager) {
//     return {
//       isError: true,
//       content: [{
//         type: 'text',
//         text: 'Unauthorized: setup_thread_workspace tool can only be used by the manager thread'
//       }]
//     };
//   }

//   if (!codex.threadExists(input.threadId)) {
//     return {
//       isError: true,
//       content: [{
//         type: 'text',
//         text: `Thread with ID ${input.threadId} does not exist`
//       }]
//     };
//   }

//   const thread = codex.thread(input.threadId);
//   try {
//     await addDetachedGitWorktree({
//       location: thread.workspaceDir,
//       repo: input.gitRepo,
//       branch: 'main'
//     });
//   } catch (error) {
//     return {
//       isError: true,
//       content: [{
//         type: 'text',
//         text: `Failed to set up workspace for thread ${input.threadId}\nError: ${error}`
//       }]
//     };
//   }

//   return {
//     isError: false,
//     content: [{
//       type: 'text',
//       text: `Workspace set up for thread ${input.threadId}`
//     }]
//   };
// });

server.registerTool("git_clone", {
  description: "Tool for cloning a git repository. Must clone from an ssh URL and the destination must be a relative path within the current working directory.",
  inputSchema: z.object({
    gitRepo: z.string(),
    branch: z.string(),
    destination: z.string(),
  }),
}, async (input) => {
  if (!input.gitRepo.startsWith("git@")) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Invalid git repository URL. Only SSH URLs starting with git@ are supported.'
      }]
    };
  }

  const workingDir = await getWorkingDirectory();
  const destinationPath = path.join(workingDir, input.destination);
  if (destinationPath.includes('..')) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Invalid destination path'
      }]
    };
  }

  try {
    await addDetachedGitWorktree({
      location: destinationPath,
      repo: input.gitRepo,
      branch: input.branch
    });
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Failed to clone repository\nError: ${error}`
      }]
    };
  }

  return {
    isError: false,
    content: [{
      type: 'text',
      text: `Repository cloned to ${destinationPath}`
    }]
  };
});


const setupInstructionsPath = path.join(configDir, "workspace_setup_instructions.json");
function getSetupInstructions() {
  return fs.readFile(setupInstructionsPath, "utf-8")
    .then(contents => JSON.parse(contents))
    .catch(() => ({}));
}

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
        mimeType: 'application/json',
        text: JSON.stringify(instructions),
      }]
    };
  }
);

server.registerTool("set_workspace_setup_instructions", {
  description: "Tool for writing the contents of the workspace setup instructions resource.",
  inputSchema: z.object({
    key: z.string(),
    text: z.string(),
  })
}, async (input) => {

  const { key, text } = input;
  if (key.startsWith("__") || key.endsWith("__")) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Keys starting and ending with "__" are reserved and cannot be modified.'
      }]
    };
  }

  const instructions = await getSetupInstructions();
  instructions[key] = text;
  await fs.writeFile(setupInstructionsPath, JSON.stringify(instructions));

  return {
    isError: false,
    content: [{
      type: 'text',
      text: 'Workspace setup instructions updated successfully'
    }]
  };
});

server.connect(new StdioServerTransport());
