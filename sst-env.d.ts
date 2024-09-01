/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    "api": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "certs": {
      "name": string
      "type": "sst.aws.Bucket"
    }
    "landing": {
      "type": "sst.aws.StaticSite"
      "url": string
    }
    "manage": {
      "type": "sst.aws.ApiGatewayV2"
      "url": string
    }
    "web": {
      "type": "sst.aws.StaticSite"
      "url": string
    }
  }
}
export {}
