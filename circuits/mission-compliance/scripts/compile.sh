#!/usr/bin/env bash
# circuits/mission-compliance/scripts/compile.sh
#
# Compiles the MissionCompliance circuit.
# Requires: circom (version pinned in REFERENCES.md §9), node, snarkjs
#
# STATUS: Stub — requires circom to be installed.
# Run from the repo root: bash circuits/mission-compliance/scripts/compile.sh
#
# ref: user request §9

set -euo pipefail

CIRCUIT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_SRC="$CIRCUIT_DIR/src/mission_compliance.circom"
ARTIFACTS_DIR="$CIRCUIT_DIR/artifacts"
CIRCOMLIB_DIR="$(cd "$CIRCUIT_DIR/../../node_modules/circomlib" && pwd 2>/dev/null || echo "NOT_FOUND")"

echo "=== Dabbawala Protocol: Circuit Compilation ==="
echo "Circuit: $CIRCUIT_SRC"
echo "Output:  $ARTIFACTS_DIR"

# Check circom is installed
if ! command -v circom &> /dev/null; then
  echo "ERROR: circom not found. Install instructions:"
  echo "  curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh"
  echo "  cargo install circom"
  echo "  See: https://docs.circom.io/getting-started/installation/"
  exit 1
fi

CIRCOM_VERSION=$(circom --version 2>&1 | head -1)
echo "circom version: $CIRCOM_VERSION"

if [ "$CIRCOMLIB_DIR" = "NOT_FOUND" ]; then
  echo "ERROR: circomlib not found. Run: pnpm install (from repo root)"
  exit 1
fi

mkdir -p "$ARTIFACTS_DIR"

echo "Compiling circuit..."
circom "$CIRCUIT_SRC" \
  --r1cs \
  --wasm \
  --sym \
  --output "$ARTIFACTS_DIR" \
  --include "$(dirname "$CIRCOMLIB_DIR")"

echo "=== Compilation complete ==="
echo "Artifacts:"
ls -lh "$ARTIFACTS_DIR"
echo ""
echo "IMPORTANT: A trusted setup (Powers of Tau ceremony) is required before"
echo "           proof generation. Development keys are NOT production-secure."
echo "           See circuits/mission-compliance/scripts/setup.sh"

