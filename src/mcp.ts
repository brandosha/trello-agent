import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { makeTrelloApiRequest } from './lib/trello.js';


const server = new McpServer({
  name: 'Trello Agent MCP',
  version: '0.1.0',
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
    const response = await makeTrelloApiRequest(input.endpoint, input.method, input.body);
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

server.connect(new StdioServerTransport());
