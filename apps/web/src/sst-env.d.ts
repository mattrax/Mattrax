/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    DatabaseURL: {
      type: "sst.sst.Secret"
      value: string
    }
    EntraClientID: {
      type: "sst.sst.Secret"
      value: string
    }
    EntraClientSecret: {
      type: "sst.sst.Secret"
      value: string
    }
    FeedbackDiscordWebhookURL: {
      type: "sst.sst.Secret"
      value: string
    }
    InternalSecret: {
      type: "sst.sst.Secret"
      value: string
    }
    MattraxWebIAMUserAccessKey: {
      id: string
      secret: string
      type: "aws.iam/accessKey.AccessKey"
    }
    StripeSecretKey: {
      type: "sst.sst.Secret"
      value: string
    }
    WaitlistDiscordWebhookURL: {
      type: "sst.sst.Secret"
      value: string
    }
  }
}
export {}
