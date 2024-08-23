#!/bin/bash

set -e

# TODO: Probs replace this with SST cause it's hacky

# aws iam create-role \
#     --role-name mattrax-platform-exec \
#     --assume-role-policy-document \
#     file://policy.json

# aws lambda create-function \
#     --function-name mattrax-platform \
#     --handler bootstrap \
#     --runtime provided.al2023 \
#     --role arn:aws:iam::101829795063:role/mattrax-platform-exec \
#     --architectures arm64 \
#     --zip-file fileb://../../target/lambda/mattrax-platform/bootstrap.zip

cargo lambda build --arm64 --release --bin lambda --output-format zip

aws lambda update-function-code \
    --function-name mattrax-platform \
    --zip-file fileb://../../target/lambda/lambda/bootstrap.zip