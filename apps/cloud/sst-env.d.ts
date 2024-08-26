/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    "DiscordWebhookUrl": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "certs": {
      "name": string
      "type": "sst.aws.Bucket"
    }
    "platform": {
      "type": "sst.aws.ApiGatewayV2"
      "url": string
    }
  }
}
export {}
