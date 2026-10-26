# One image, one origin: the API serves the built web app (WEB_DIST_DIR), so the browser needs
# no CORS and the SSE progress stream goes straight to the API.
#
#   docker build -t scan-review .
#   docker run --rm -p 8787:8787 scan-review                 # offline demo (mock mode)
#   docker run --rm -p 8787:8787 -e SCANNER_MODE=live scan-review

# Both stages use the multi-arch digest of node:22.23.4-alpine3.24 (amd64 for Render, arm64 for
# Apple silicon), written out in each FROM so Dependabot can update them.

# ---- build: install everything, compile shared, api and web ----
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# No install scripts from dependencies; the one we need (building shared) runs explicitly below.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build

# ---- runtime: production dependencies and compiled output only ----
FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    WEB_DIST_DIR=/app/apps/web/dist \
    SCANNER_MODE=mock
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace @ox-scan/api --workspace @ox-scan/shared \
    && npm cache clean --force \
    # The app never runs a package manager: drop npm, npx, corepack and yarn from the final image.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/fixtures apps/api/fixtures
COPY --from=build /app/apps/web/dist apps/web/dist

# Unprivileged user from the base image; the app never writes to disk.
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
# Node as PID 1 receives SIGTERM directly, so the graceful shutdown in server.ts runs.
CMD ["node", "apps/api/dist/server.js"]
