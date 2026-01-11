FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install
RUN pnpm --filter @mini-app/shared build
RUN pnpm --filter @mini-app/api build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api

RUN pnpm install --prod
WORKDIR /app/apps/api

EXPOSE 3001
CMD ["node", "dist/index.js"]
