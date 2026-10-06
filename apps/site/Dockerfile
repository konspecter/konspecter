# Konspecter account site: React Router server rendering on Node.
# Built from the repository root, since the site uses the workspace packages:
#   docker build -f apps/site/Dockerfile -t konspecter-site .
#   docker run -e KONSPECTER_API_URL=http://server:8080 -p 3000:3000 konspecter-site
FROM node:22-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/site/ apps/site/
RUN pnpm install --frozen-lockfile --filter "@konspecter/site..."
RUN pnpm --filter @konspecter/site build \
  && pnpm --filter @konspecter/site deploy --legacy --prod /out \
  && cp -r apps/site/build /out/build

FROM node:22-slim
LABEL org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=build /out/ ./
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node_modules/.bin/react-router-serve", "build/server/index.js"]
