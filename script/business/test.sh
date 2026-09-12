#!/usr/bin/env bash
# test.sh: the whole thing from an empty chain, including every refusal, and then stop the chain.
# This is the command that answers "does it actually work", and it answers it with counts.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/business/lib.sh
. script/business/lib.sh
banner
heading "Running the full check from an empty chain"
log "  This installs the product, sells three times, and then tries every way a payment should be"
log "  refused. It fails loudly on the first thing that does not behave. It takes a few minutes."
bash script/anvil/test.sh
