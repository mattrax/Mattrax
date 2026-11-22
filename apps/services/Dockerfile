# syntax=docker/dockerfile:1.7
#
# Hosted Mattrax services: APNs relay and Stripe billing for Cloud and
# self-hosted deployments. The process is a plain Node HTTP server; the
# workspace packages are consumed from source through tsx so a deploy only
# needs the repository and pnpm.

FROM node:26-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.21.0

WORKDIR /repo
COPY . .

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production \
    PORT=8788

EXPOSE 8788

CMD ["pnpm", "--filter", "@mattrax/services", "start"]
