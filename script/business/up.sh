#!/usr/bin/env bash
# up.sh: start the practice chain and put the payment product on it. LOCAL_ANVIL_NO_VALUE.
# Nothing has been sold yet when this finishes; `make business-demo` is the one that sells.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=script/business/lib.sh
. script/business/lib.sh
banner
heading "Starting"
quietly "Starting the practice chain" up bash script/anvil/up.sh
quietly "Installing the payment product" deploy bash script/anvil/deploy.sh
quietly "Opening the conversion market" seed bash script/anvil/seed.sh
heading "Ready"
log "  The practice chain is running and the payment product is installed."
log "  Next: make business-demo   (sell something, twice, and prove both payments)"
log "        make business-open   (open the screens in a browser)"
