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
`/app/data` if you want configuration, database state, and thread workspaces to
persist across container restarts.
