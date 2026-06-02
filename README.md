# trello-agent

## Docker

Build the image:

```sh
docker build -t trello-agent .
```

Run the server:

```sh
docker run --rm -p 7654:7654 -v trello-agent-data:/app/data trello-agent
```

Or use Docker Compose:

```sh
docker compose up --build
```

The container uses pnpm through Corepack for dependency installation. It builds
with `config.example.ts` as `config.ts`, which sets the server port to `7654`.
Runtime Trello configuration is stored in the app data directory, so mount
`/app/data` if you want configuration and database state to persist across
container restarts.

Agent thread execution is delegated to the `multiagent-container` service. In
Docker Compose, trello-agent reaches it at `http://multiagent-container`; local
development can override `config.multiagentContainerUrl` in `config.ts`.
Codex CLI authentication, sandboxed thread workspaces, and the SSH key used by
agent git operations live in the multiagent-container `/agents` volume.

The trello-agent container still sets `HOME=/app/data` for its own runtime data.
Database migrations are copied into the runtime image at `/app/drizzle`.

## Internal MCP Server

trello-agent serves its user-facing app/websocket traffic on `config.port`
(`7654` by default). It also starts a separate MCP HTTP server on
`config.mcpPort` (`7655` by default). Docker Compose exposes the MCP port only
inside the compose network so sandboxed agents in `multiagent-container` can
reach it at `config.mcpInternalUrl` (`http://trello-agent:7655/mcp` by
default) without publishing it to the host.

Each sandboxed thread receives a per-thread MCP config update before prompts.
The config includes a JWT bearer token and `X-Agent-ID` header for that
thread's string ID. trello-agent rejects MCP requests unless the JWT agent ID
matches the `X-Agent-ID` header and the string thread ID exists locally. If
`config.mcpJwtSecret` is not set, trello-agent generates a secret and persists
it in the app database.
