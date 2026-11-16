FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY public ./public
COPY server ./server

EXPOSE 3000
CMD ["node", "server/index.js"]
