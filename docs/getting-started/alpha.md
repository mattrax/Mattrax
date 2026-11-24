# What alpha means

Mattrax Cloud is free while it is in alpha. Alpha is not a pricing tier or a
synonym for "released": it describes the support and durability you can expect
today. This page is the honest version so you can decide whether a workload
belongs here yet.

## Support is best effort

Alpha support comes from the team that builds Mattrax. Email
[hello@mattrax.app](mailto:hello@mattrax.app) or ask in the
[Discord](https://discord.gg/WPBHmDSfAn). We read every message and try to
answer quickly, but there is no service-level agreement, no 24/7 on-call rota
and no guaranteed response time. Security reports are prioritised over feature
questions.

Self-hosted deployments are supported through the same channels and the
[operations docs](/operations/deployment). Running the product yourself does
not change what alpha means for the software.

## Backups exist, but treat alpha data as replaceable

Cloud runs a nightly logical backup of the production database. Backups are
kept for 90 days, and the worst case is losing up to a day of writes; this is
not point-in-time recovery. The mechanics are documented in
[Backups](/operations/backups).

That is a safety net, not a durability guarantee. Alpha software can still lose
data to a bug, a failed migration or an integration that has not met real
hardware yet. Keep a [tenant export](/admin/#tenant-export-and-import) or your own copy of
anything you cannot recreate, and do not make Mattrax the only home for
irreplaceable records.

## Breaking changes can happen

The dashboard, API, policy catalogue and database schema can change without a
deprecation window. Database migrations are applied as part of a deployment.
We try to call out breaking changes in release notes and on GitHub, but alpha
does not promise advance notice, API versioning or a rollback path.

If you build automation against the API, pin the behaviour you depend on and
test it against a staging tenant before pointing it at a production fleet.

## What is already real

Alpha does not mean "demo". Enrollment, policy delivery, inventory, audit,
webhooks, SSO/SCIM and the REST API are implemented and covered by tests. The
[production readiness](/reference/production-readiness) page separates what is
hardened from what still needs real-device or real-vendor validation. Check
that page before you rely on a platform, especially Android and the Windows
zero-touch flows.

## Signed in on the public site

The marketing pages and sign-up screen notice an existing session. Marketing calls to
action become **Open dashboard**, and the sign-in/register cross-links are hidden so an
already-signed-in visitor is not sent back through authentication. The login and
registration forms remain for deliberately switching accounts; the sign-up warning
explains that a second account needs a fresh sign-in and offers both **Open dashboard**
and **Sign out**.

## How to give feedback

- **Bugs and feature requests:** open an issue at
  [github.com/oscartbeaumont/mattraxe](https://github.com/oscartbeaumont/mattraxe)
  or post in the [Discord](https://discord.gg/WPBHmDSfAn).
- **Security reports:** email [hello@mattrax.app](mailto:hello@mattrax.app)
  instead of opening a public issue.
- **Product questions:** email [hello@mattrax.app](mailto:hello@mattrax.app).

Useful reports include the tenant slug, the time in UTC, the device serial or
policy name, what you expected and what happened. Please do not paste secrets,
recovery keys or full enrollment profiles into an issue.
