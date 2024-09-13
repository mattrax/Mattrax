#!/bin/bash

set -e

if ! command -v cargo-lambda &> /dev/null
then
    pip3 install cargo-lambda
    rustup toolchain install stable --profile minimal
    rustup target add x86_64-unknown-linux-musl
fi

cargo lambda "$@"