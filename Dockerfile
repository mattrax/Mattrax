# syntax=docker/dockerfile:1.7
#
# Mattrax self-hosted image.
#
# The product is two Cloudflare Workers: `mattrax` (the SolidStart dashboard and
# static assets) and `mattrax-api` (the product API and MDM protocol endpoints).
# The dashboard proxies /api, /mdm and /scim to the API Worker over a service
# binding, so the image runs both Workers in one workerd instance behind a
# single port.
#
# `workerd` is the same JavaScript/Wasm runtime Cloudflare runs in production;
# Miniflare supplies the platform services (R2, Hyperdrive, cron, static assets)
# that the container has no managed equivalent for.

FROM node:24-bookworm-slim AS build

# workerd validates the system trust store when it starts, even for a build.
# binutils is used to strip debug symbols from the binaries that reach the
# runtime; it stays in this stage.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates binutils \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    PATH=/pnpm:$PATH
RUN npm install --global pnpm@10.33.2

WORKDIR /repo
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# Prebuild every Worker and module. Nothing is bundled or transpiled at boot.
# The docs are built into the dashboard's assets so a self-hosted install serves
# the same `/docs/` surface (and sitemap) as the hosted deployment.
RUN pnpm api build && pnpm web build && pnpm doc:build \
    && cd apps/web && node ../../scripts/copy-docs.mjs

# Collect Workers, static assets and migrations, dropping source maps and
# editor-only migration snapshots.
RUN node apps/selfhost/scripts/stage.mjs /repo /out

# A production-only install of the runtime host. The `workerd` npm package
# exposes a CLI copy of the platform binary that the runtime never invokes.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @mattrax/selfhost deploy --prod --legacy /out/selfhost \
    && rm -rf /out/selfhost/node_modules/.pnpm/workerd@*/node_modules/workerd/bin

# Miniflare lists `sharp` as an optional dependency for its container-image
# support, which Mattrax does not use; its platform codecs are ~20 MB. The
# `@types/*` packages are type-only peer dependencies that Node never loads.
# Remove them, then clean up the symlinks pnpm leaves pointing at them.
RUN rm -rf \
      /out/selfhost/node_modules/.pnpm/sharp@* \
      /out/selfhost/node_modules/.pnpm/@img+* \
      /out/selfhost/node_modules/.pnpm/@types+node@* \
      /out/selfhost/node_modules/.pnpm/undici-types@* \
    && find /out/selfhost/node_modules -xtype l -delete

# The published workerd binaries carry full debug symbols (~53 MB per
# platform). `strip` leaves a runnable binary and removes information the
# runtime never reads. The glob covers both linux-arm64 and linux-64 builds.
RUN find /out/selfhost/node_modules/.pnpm \
      -path '*/@cloudflare/workerd-linux-*/bin/workerd' -type f \
      -exec strip {} +

# Node's release binaries also ship with debug symbols (~20 MB). This is the
# binary copied to the runtime stage, and the build is complete by now.
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
    HOME=/home/node

COPY --from=build /out/etc/passwd /etc/passwd
COPY --from=build /out/etc/group /etc/group
COPY --from=build /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

COPY --from=build --chown=1000:1000 /out/selfhost/ ./
COPY --from=build --chown=1000:1000 /out/workers/ ./workers/
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
CMD ["src/server.mjs"]
