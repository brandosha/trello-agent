# syntax=docker/dockerfile:1.7

FROM node:22-slim AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@10.33.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json ./
COPY config.example.ts ./config.ts
COPY src ./src
COPY public ./public

RUN pnpm build
RUN pnpm prune --prod

FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOME=/app/data
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.4 --activate \
  && mkdir -p "$HOME" \
  && sed -i 's#^\(root:[^:]*:[^:]*:[^:]*:[^:]*:\)/root:#\1/app/data:#' /etc/passwd

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY drizzle ./drizzle

VOLUME ["/app/data"]
EXPOSE 7654

CMD ["pnpm", "start"]
