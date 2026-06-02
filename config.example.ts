export const config = {
  port: 7654,
  mcpPort: 7655,
  mcpInternalUrl: "http://trello-agent:7655/mcp",
  // Optional. If omitted, trello-agent generates and persists a secret in its DB.
  mcpJwtSecret: undefined as string | undefined,
  multiagentContainerUrl: "http://multiagent-container",
};
