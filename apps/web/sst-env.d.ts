/* This file is auto-generated by SST. Do not edit. */
/* tslint:disable */
/* eslint-disable */
import "sst"
export {}
declare module "sst" {
  export interface Resource {
    "DatabaseURL": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "EntraClientID": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "EntraClientSecret": {
      "type": "sst.sst.Secret"
      "value": string
    }
    "cloud": {
      "name": string
      "type": "sst.aws.Function"
      "url": string
    }
    "email": {
      "sender": string
      "type": "sst.aws.Email"
    }
  }
}
