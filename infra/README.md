# Infrastructure

This folder contains configuration for the infrastructure which powers [Mattrax Cloud](https://cloud.mattrax.app).

This configuration is not intended for general use so you will not need it for self-hosting Mattrax.

We use [SST Ion](https://ion.sst.dev/docs/) (which under the hook uses [Pulumi](https://www.pulumi.com)) to manage our configuration.

Stack:
 - [Amazon SES](https://aws.amazon.com/ses/) - Email
 - [Cloudflare Pages](https://pages.cloudflare.com/) - Hosting & Compute for JS
 - [Cloudflare R2](https://developers.cloudflare.com/r2) - Object storage
 - [Amazon EC2](https://aws.amazon.com/ec2/) - Compute for MDM backend
 - [TODO](#todo) - Database
