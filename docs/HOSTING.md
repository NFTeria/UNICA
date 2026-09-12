# Hosting UNICA at a public URL

The screens and their companion run on a laptop with `make business-open` and `make business-live`.
This is how the same thing runs at a URL a stranger can open, with the node's address kept on the
server. Only the owner runs these: nothing in this repository publishes anything.

## The commands

Run them from the repository root, in this order.

```sh
vercel login
vercel link                                   # create a new project, named: unica
vercel env add UNICA_RPC_URL production       # paste the node URL at the prompt — never into a file
printf 'deployments/unica-v4/11155111.json' | vercel env add UNICA_MANIFEST_PATH production
vercel --prod
```

`ETHERSCAN_API_KEY` is strongly advised on a public host. The business lookups and the receipt
evidence read logs from an explorer; the keyless Blockscout API throttles a shared hosting egress
long before it throttles a laptop, and a throttled lookup is a business page that cannot see its
own name. With the key set, the host reads logs from Etherscan's V2 API first and keeps Blockscout
as the fallback. The key is used only inside the function and never appears in a response:

```sh
vercel env add ETHERSCAN_API_KEY production       # paste the key at the prompt — never into a file
```

`UNICA_SUBGRAPH_URL` is optional. Add it only if the screens should read a published index:

```sh
vercel env add UNICA_SUBGRAPH_URL production
```

## A domain with history, not a fresh one

Wallet security scanners weigh the domain a page is served from. A days-old `*.vercel.app` hostname
that opens a wallet connection matches their phishing heuristics, and MetaMask showed exactly that
warning on the first listing from one. The product is therefore served from a subdomain of a
domain the project has held for longer:

```sh
vercel domains add unica.nfteria.click                        # binds the name to the linked project
# then, at the DNS provider: CNAME unica.nfteria.click -> cname.vercel-dns.com
```

Vercel issues the certificate once the record resolves. The `*.vercel.app` alias keeps working; the
custom name is the one to hand out.

## What to check, on the URL it prints

```sh
curl -s https://<the-url>/local/config.json | head -20
```

It must answer `"chainId": 11155111` and `"rpc": "/local/rpc"`. The `rpc` field is the same-origin
pipe, not the node: if the node's URL appears anywhere in that output, stop and rotate the key,
because the browser has been handed it.

Then open `https://<the-url>/` in a browser and log in with a wallet on Sepolia. The home page is
the check that matters — it reads the same config, and every read and send it makes goes through
`/local/rpc`.

## What this host cannot do

**The practice chain is not reachable from it.** `make business-open` serves the screens against
Anvil on this machine, at an address that exists only on this machine. A public host can only reach
a public network, so a deployment is a Sepolia deployment (or another public test network), never
the practice chain. The practice chain stays a local thing, and that is not a setting that can be
changed.

**One deployment serves one network.** `UNICA_MANIFEST_PATH` and `UNICA_RPC_URL` are set per
deployment, and every screen reads the one manifest they name. Two networks means either two Vercel
projects, one per network, or changing those two variables and deploying again — there is no switch
in the product, because a page that could silently change which chain it is describing is a page
that can show a customer terms from a chain they are not paying on.

**The pipe hides the node's URL, not the node's quota.** `/local/rpc` refuses a browser page on
another site (the browser says so in `Sec-Fetch-Site`, and the pipe reads it), so no other site
can spend the node through a visitor's browser. A client that is not a browser page — `curl`, a
script — is let through, because the same-origin question has no answer for it. So the URL never
leaves the host, and anyone who finds the pipe can still spend the node's request quota through
it. The remedy is a limit on the node provider's side or a rate rule on the host; neither is set
up here, and this document does not claim otherwise.
