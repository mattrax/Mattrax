/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
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
