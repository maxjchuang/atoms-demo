# Official per-platform Node manifest selected by native daemon-checked build wrapper.
ARG NODE_BASE=docker.io/library/node:26.5.0-bookworm-slim@sha256:9e5d714311940c098479ec352029af6df1d9a2dc4269b29373c616f51640dd67
FROM ${NODE_BASE} AS deps
WORKDIR /opt/atoms
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global pnpm@10.33.0 --ignore-scripts --registry=https://registry.npmjs.org
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm --filter '@atoms/api...' --filter '@atoms/web...' install --frozen-lockfile --ignore-scripts
COPY packages/contracts/src packages/contracts/src
COPY apps/api/src apps/api/src
COPY deploy/m3 deploy/m3

FROM deps AS api
ARG SOURCE_REVISION=unknown
ARG SOURCE_CONTEXT=unknown
LABEL atoms.source-kind="reviewed-worktree-context" atoms.git-head-at-build=$SOURCE_REVISION atoms.source-state="working-tree-context" atoms.owner="atoms-v03" atoms.role="api" atoms.context-sha256=$SOURCE_CONTEXT
RUN mkdir -p /data/api /run/api-secrets /run/agent-secrets /run/broker-secrets /run/admin-code /run/m3 && chmod 700 /run/api-secrets /run/agent-secrets /run/broker-secrets /run/admin-code && chown -R node:node /data /run/api-secrets /run/agent-secrets /run/broker-secrets /run/admin-code /run/m3
USER node
WORKDIR /opt/atoms/apps/api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3001 PREVIEW_PORT=3002
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD node -e "fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--import","tsx","src/main.ts"]

FROM deps AS webbuild
ARG ATOMS_RUNTIME_MODE=fake
COPY apps/web/src apps/web/src
COPY apps/web/index.html apps/web/tsconfig.json apps/web/vite.config.ts apps/web/
RUN VITE_RUNTIME_MODE=$ATOMS_RUNTIME_MODE VITE_COORDINATOR_MODE=$ATOMS_RUNTIME_MODE pnpm --filter @atoms/web build

FROM ${NODE_BASE} AS gateway
ARG SOURCE_REVISION=unknown
ARG SOURCE_CONTEXT=unknown
LABEL atoms.source-kind="reviewed-worktree-context" atoms.git-head-at-build=$SOURCE_REVISION atoms.source-state="working-tree-context" atoms.owner="atoms-v03" atoms.role="gateway" atoms.context-sha256=$SOURCE_CONTEXT
COPY --from=webbuild /opt/atoms/apps/web/dist /srv/web
COPY deploy/m3/gateway.mjs /srv/gateway.mjs
USER node
ENV NODE_ENV=production PORT=8080 M3_WEB_DIR=/srv/web
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD node -e "fetch('http://127.0.0.1:8080/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","/srv/gateway.mjs"]
