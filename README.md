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
