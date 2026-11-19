# syntax=docker/dockerfile:1.7
#
# Mattrax self-hosted image.
#
# The hosted product is two Cloudflare Workers: `mattrax` (the SolidStart
# dashboard and static assets) and `mattrax-api` (the product API and MDM
# endpoints). A container runs the same code on Node instead: the API is a
# shared Effect runtime with Node adapters for MySQL, filesystem storage and
# SMTP, and the dashboard is the Solid SSR Node server. One Node process owns
# both behind a single port, with `/api`, `/mdm` and `/scim` routed to the API.

FROM node:26-bookworm-slim AS build

# Node validates the system trust store when it starts, even for a build.
# binutils strips debug symbols from the Node binary that reaches the runtime;
# it stays in this stage.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates binutils \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH
RUN npm install --global pnpm@12.21.0

WORKDIR /repo
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# Prebuild every entry point. Nothing is bundled or transpiled at boot. The docs
# are built into the dashboard's client assets so a self-hosted install serves
# the same `/docs/` surface (and sitemap) as the hosted deployment.
RUN pnpm doc:build && pnpm docker build:api \
    && pnpm --filter @mattrax/web build:selfhost

# Collect the API bundle, dashboard server/client and migrations, dropping
# source maps and editor-only migration snapshots.
RUN node apps/docker/scripts/stage.ts /repo /out

# A production-only install of the runtime host. The API and dashboard bundles
# carry their own dependencies; the host only needs the migration runner's
# MySQL client. Prune and clean in the same layer: a later `RUN` would store the
# files again as another layer (and unpacking pays for every file it writes).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @mattrax/docker deploy --prod --legacy \
      --config.allow-unused-patches=true /out/selfhost \
    && node apps/docker/scripts/prune-node-modules.mjs /out/selfhost/node_modules \
    && rm -rf /out/selfhost/node_modules/.pnpm/@types+node@* \
      /out/selfhost/node_modules/.pnpm/undici-types@* \
    && find /out/selfhost/node_modules -xtype l -delete

# Node's release binaries ship with debug symbols (~20 MB). This is the binary
# copied to the runtime stage, and the build is complete by now.
RUN strip /usr/local/bin/node

# The runtime has no shell to create users or directories at boot, so prepare
# both here. UID/GID 1000 keeps an existing `/data` volume writable after an
# upgrade, and the baseline `node` user name.
RUN mkdir -p /out/etc /out/data /out/home/node \
    && printf '%s\n' \
      'root:x:0:0:root:/root:/sbin/nologin' \
      'nobody:x:65534:65534:nobody:/nonexistent:/sbin/nologin' \
      'nonroot:x:65532:65532:nonroot:/home/nonroot:/sbin/nologin' \
      'node:x:1000:1000:node:/home/node:/sbin/nologin' > /out/etc/passwd \
    && printf '%s\n' \
      'root:x:0:' \
      'nobody:x:65534:' \
      'nonroot:x:65532:' \
      'node:x:1000:' > /out/etc/group

# A distroless base supplies glibc, libstdc++, CA certificates and tzdata but
# no shell, package manager or Node. That removes the apt and npm trees from
# the image and leaves nothing to run arbitrary installs with if the process is
# compromised. Node comes from the build stage so it can be stripped.
FROM gcr.io/distroless/cc-debian12:nonroot AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    HOME=/home/node \
    LD_LIBRARY_PATH=/usr/lib/node-libs

COPY --from=build /out/etc/passwd /etc/passwd
COPY --from=build /out/etc/group /etc/group
COPY --from=build /usr/local/bin/node /usr/local/bin/node

# Node 26 is linked against libatomic on both amd64 and arm64; distroless's
# `cc` image carries libstdc++ and libgcc but not it. Ship it beside the
# binary. The multiarch directory name differs per architecture, so copy the
# match into one fixed directory and point the loader at it.
COPY --from=build /usr/lib/*-linux-gnu/libatomic.so.1* /usr/lib/node-libs/

WORKDIR /app

COPY --from=build --chown=1000:1000 /out/selfhost/ ./
COPY --from=build --chown=1000:1000 /out/api/ ./api/
COPY --from=build --chown=1000:1000 /out/web/ ./web/
COPY --from=build --chown=1000:1000 /out/migrations/ ./migrations/

# The `/data` volume and the home directory the `node` user expects. An empty
# directory in the build stage is the only way to create one without a shell.
COPY --from=build --chown=1000:1000 /out/data/ /data/
COPY --from=build --chown=1000:1000 /out/home/node/ /home/node/

USER node

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["/usr/local/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/node"]
CMD ["src/server.ts"]
