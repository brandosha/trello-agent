import { McpServer, ServerContext, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { codex } from './lib/codex.js';
import { threadsDir } from './lib/paths.js';
import { makeTrelloApiRequest } from './lib/trello.js';
import { addDetachedGitWorktree } from './lib/workspaces.js';


const server = new McpServer({
  name: 'Trello Agent MCP',
  version: '0.1.0',
}, {
  capabilities: {
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

  try {
    const response = await makeTrelloApiRequest({
      method: input.method,
      endpoint: input.endpoint,
      body: input.body,
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

server.registerTool("prompt_thread", {
  description: "Tool for sending a prompt to a thread. Only the manager thread is authorized to use this tool.",
  inputSchema: z.object({
    threadId: z.string(),
    prompt: z.string(),
  })
}, async (input, context) => {
  const isManager = await isManagerThread(context);
  if (!isManager) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Unauthorized: prompt_thread tool can only be used by the manager thread'
      }]
    };
  }

  if (!codex.threadExists(input.threadId)) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Thread with ID ${input.threadId} does not exist`
      }]
    };
  }

  const thread = codex.thread(input.threadId);
  thread.queueInput(input.prompt, 'system/mcp/prompt_thread');

  return {
    isError: false,
    content: [{
      type: 'text',
      text: `Prompt sent to thread ${input.threadId}`
    }]
  };
});

server.registerTool("setup_thread_workspace", {
  description: "Tool for setting up git worktree for a thread. Only the manager thread is authorized to use this tool. Always prefer ssh git URLs.",
  inputSchema: z.object({
    threadId: z.string(),
    gitRepo: z.string(),
  })
}, async (input, context) => {
  const isManager = await isManagerThread(context);
  if (!isManager) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: 'Unauthorized: setup_thread_workspace tool can only be used by the manager thread'
      }]
    };
  }

  if (!codex.threadExists(input.threadId)) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Thread with ID ${input.threadId} does not exist`
      }]
    };
  }

  const thread = codex.thread(input.threadId);
  try {
    await addDetachedGitWorktree({
      location: thread.workspaceDir,
      repo: input.gitRepo,
      branch: 'main'
    });
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Failed to set up workspace for thread ${input.threadId}\nError: ${error}`
      }]
    };
  }

  return {
    isError: false,
    content: [{
      type: 'text',
      text: `Workspace set up for thread ${input.threadId}`
    }]
  };
});

server.connect(new StdioServerTransport());
