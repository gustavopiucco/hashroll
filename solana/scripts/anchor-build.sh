#!/usr/bin/env bash
# Runs INSIDE the solanafoundation/anchor container (see `npm run build:program`).
set -euo pipefail
cd /work

# Platform-tools ships Cargo 1.84: resolve dependencies to versions compatible with it.
export CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback
[ -f Cargo.lock ] || cargo generate-lockfile

# Use the committed dev program keypair so the program ID matches declare_id!.
mkdir -p target/deploy
cp keys/dev/program.json target/deploy/hashroll-keypair.json

anchor build
cargo test --quiet -p hashroll --lib

# Publish the IDL and the TypeScript type to the client package.
mkdir -p client/src/idl
cp target/idl/hashroll.json client/src/idl/hashroll.json
cp target/types/hashroll.ts client/src/idl/hashroll.ts
echo "Program built: target/deploy/hashroll.so"
