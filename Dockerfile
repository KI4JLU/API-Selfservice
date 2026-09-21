# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @litelite/web build
RUN pnpm --filter @litelite/api build

# ---- runtime ----
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --filter @litelite/api...
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/src packages/shared/src
COPY --from=build /app/packages/db/src packages/db/src
COPY --from=build /app/packages/db/drizzle packages/db/drizzle
COPY --from=build /app/apps/web/dist apps/api/public
EXPOSE 3030
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3030/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
