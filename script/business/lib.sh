#!/usr/bin/env bash
# lib.sh: the small shared part of the business command surface (`make business-*`).
#
# These five commands are the ones a business owner runs. Everything they print is in the words a
# business uses: a business, a register, a customer, a sale, a payment. The parts an engineer needs
# (identifiers, transaction hashes, log files) are printed too, but only under "Advanced
# verification" at the end, because a person deciding whether they were paid should not have to
# read a hash to find out.
#
# Sourced, never executed.

# shellcheck source=script/anvil/lib.sh
. script/anvil/lib.sh

BUSINESS_SERVER_PID_FILE="$REHEARSAL_DIR/business-server.pid"

banner() {
  printf '\n'
  printf '  UNICA  ·  TESTNET / NO VALUE\n'
  printf '  A practice chain on this computer. No real money can move here.\n'
  printf '  Amounts are shown in uUSD, a local test dollar. It is not USDC and it is worth nothing.\n\n'
}

heading() { printf '\n--- %s\n' "$*"; }

# Format a base-unit amount with the decimals the manifest records for that symbol, so an amount is
# never printed with a decimal count written into this script by hand.
money() { # $1 base units, $2 symbol
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const a = (m.assets || []).find((x) => x.symbol === process.argv[2]);
    if (!a) { console.log(`${process.argv[1]} (unlabelled units)`); process.exit(0); }
    const d = BigInt(10) ** BigInt(a.decimals);
    const v = BigInt(process.argv[1]);
    const frac = (v % d).toString().padStart(a.decimals, "0").slice(0, 2);
    console.log(`${(v / d).toString()}.${frac} ${a.symbol}`);
  ' "$1" "$2" "$MANIFEST_PATH"
}

# Run one stage, keep its engineering output in a log, and say plainly what is happening.
quietly() { # $1 human sentence, $2 log name, rest: the command
  local what=$1 name=$2; shift 2
  printf '  %s ... ' "$what"
  if "$@" >"$REHEARSAL_DIR/business-$name.log" 2>&1; then
    printf 'done\n'
  else
    printf 'FAILED\n'
    tail -40 "$REHEARSAL_DIR/business-$name.log"
    die "$what did not finish. The full output is in $REHEARSAL_DIR/business-$name.log"
  fi
}
