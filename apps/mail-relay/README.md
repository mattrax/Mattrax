# mail-relay

SMTP sidecar for self-hosted Mattrax deployments.

A container cannot open an SMTP connection from inside workerd, so the API
Worker sends one authenticated JSON request per message to this sidecar, which
delivers it through the operator's existing mail account. It is the same pattern
as `apps/apns-relay`, and it has no dependencies beyond Node.

The image already contains it at `/app/mail-relay`; start it with
`command: ["/app/mail-relay/index.ts"]` or run it directly:

```bash
MAIL_RELAY_SECRET=... SMTP_HOST=smtp.example.com SMTP_USER=... SMTP_PASSWORD=... \
  node src/index.ts
```

Configuration:

| Variable                   | Default   | Purpose                                              |
| -------------------------- | --------- | ---------------------------------------------------- |
| `MAIL_RELAY_SECRET`        | required  | Bearer secret shared with the API Worker (16+ chars) |
| `SMTP_HOST`                | required  | SMTP server hostname                                 |
| `SMTP_PORT`                | 465/587   | 465 with `SMTP_SECURE`, otherwise 587                |
| `SMTP_SECURE`              | `false`   | `true` for implicit TLS                              |
| `SMTP_USER`                | —         | Username for AUTH PLAIN/LOGIN                        |
| `SMTP_PASSWORD`            | —         | Password for `SMTP_USER`                             |
| `SMTP_REJECT_UNAUTHORIZED` | `true`    | `false` accepts a self-signed relay certificate      |
| `MAIL_FROM`                | —         | Fallback sender when a request omits one             |
| `MAIL_RELAY_PORT`          | `8790`    | Listen port                                          |
| `MAIL_RELAY_HOST`          | `0.0.0.0` | Listen address                                       |

`GET /health` reports liveness; `POST /send` requires the bearer secret and
accepts `{ to, from, replyTo?, subject, text?, html? }`. See
[Self-hosting](/operations/self-hosting) for the app-side variables.
