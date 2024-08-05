#
# WARNING: This is design for Mattrax Cloud, not for self-hosting!!!
#

# Download latest Caddy binary
FROM alpine
RUN wget -O /caddy "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com%2Fzhangjiayin%2Fcaddy-mysql-storage"
RUN chmod +x /caddy

# Create lightweight image
FROM scratch

EXPOSE 80
EXPOSE 443

ENV MATTRAX_CLOUD=true

COPY --from=0 /caddy /caddy
COPY Caddyfile /Caddyfile
COPY mattrax /mattrax

ENTRYPOINT ["/mattrax"]
CMD ["serve"]