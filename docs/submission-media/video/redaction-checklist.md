# Redaction checklist

A video is published forever and cannot be edited after it is judged. Everything below was found on
**this machine, in the commands this demo actually runs** — it is not a generic list.

> **The rule.** If a frame contains something on this list, the frame does not ship. Not blurred at
> the last minute, not "too small to read" — recut it. A blur that is one pixel too small is
> indistinguishable from no blur at all, and a viewer can step the video frame by frame.

---

## 1. Terminal username and filesystem paths — **will appear by default**

The default prompt on this machine shows the user name and the absolute path. Every command in
`timeline.md` runs from the repository checkout inside your home directory, so that path leaks in
**every terminal shot** unless the prompt is fixed before recording.

(This file deliberately does not spell out a home-directory path, even as an example. The
repository's secret scan refuses one anywhere in the tree, and a redaction checklist that leaks the
shape of the thing it is warning about is not much of a checklist.)

**Fix it in the recording shell, before the recording software starts:**

```sh
PS1='unica $ '
```

- [ ] Prompt reads exactly `unica $` — no user, no host, no path, no git branch, no timestamp.
- [ ] No command in the take is typed with an absolute home-directory path. `timeline.md` uses `~/Desktop/unica` or a bare relative path everywhere for this reason.
- [ ] The terminal's **window title bar** does not show the path either — many terminals put the working directory there. Check the title bar in a still frame, not from memory.
- [ ] The editor, if it is ever on screen, does not show a full path in its title, tab strip, or breadcrumb.
- [ ] Shell history is not visible. Do not press ↑ on camera; a previous session's command may contain anything.

## 2. `.env` values — **never on screen, never in a scrollback**

Two `.env` files matter, and both are gitignored:

| File | Holds |
|---|---|
| `integrations/chainlink-cre-guardian/workflow/.env` | the five private policy values shot 5 loads |
| repository root `.env`, if you create one | `DEPLOYER`, `DEPLOYER_ACCOUNT`, optionally `SEPOLIA_RPC_URL` and `ETHERSCAN_API_KEY` |

- [ ] **Never `cat`, `open`, `head`, `less` or `grep` either file on camera.** Shot 5 uses `set -a && . ./workflow/.env && set +a`, which exports the values and prints nothing. That is deliberate. Do not "just check" the file first.
- [ ] **Never run `env`, `printenv`, `set`, or `export` with no argument** while recording — after shot 5 the five policy values are in the environment of that shell.
- [ ] If you must inspect the file, do it in a different terminal window that is not being captured, then clear it.
- [ ] The CRE simulation output on screen is safe to film: it publishes a commitment, an action class and a reason category, and the leak tests assert no threshold appears in any published field.
- [ ] **But do not copy that output into written text.** The run captured for this package returned `bounded: true`, and by the limitation the workflow documents and tests, **a clamped amount is the per-action cap exactly** — so the `amount` field in that particular result publishes a secret-derived value. It is redacted in `timeline.md` for that reason. Filming it for two seconds is not the same as writing it into a public repository forever. Never paste it into the submission text, a README, a caption, or a social post.

## 3. API keys and credentials

- [ ] `ETHERSCAN_API_KEY` is never echoed. It reaches `forge` through the Makefile and is never printed by any command in `timeline.md`.
- [ ] **`cre whoami` prints the account email and the organization id.** It is a useful pre-flight check and it must be run **before** the recording software is capturing. Clear the terminal afterwards.
- [ ] No keystore password is typed on camera. Nothing in this demo signs — every command in `timeline.md` is read-only — so if a password prompt appears, something is wrong: stop, do not type it, and find out what asked.
- [ ] No `cast wallet`, no `--private-key`, no `--account`, no `--broadcast` in any recorded command. Grep your own take list for those five strings before recording.

## 4. RPC URLs

- [ ] The public endpoint `https://ethereum-sepolia-rpc.publicnode.com` is keyless and safe on screen — it is the default in the Makefile and in the proof scripts, and it is in the public repository.
- [ ] **A provider URL with a key in the path is not safe** — Alchemy, Infura, QuickNode and the like put the key in the URL. If `SEPOLIA_RPC_URL` is set to one of those in your shell, **unset it for the recording** and let the public default be used:
  ```sh
  unset SEPOLIA_RPC_URL && export RPC=https://ethereum-sepolia-rpc.publicnode.com
  ```
- [ ] `export RPC=…` is done **before** recording starts, so no shot contains the URL being typed.
- [ ] Check the browser too: an explorer page opened through a personalized or API-keyed link leaks the key in the address bar.

## 5. Tunnel and preview URLs

- [ ] No `ngrok`, `cloudflared`, `localtunnel`, `*.trycloudflare.com`, `*.ngrok*` or similar URL is visible in any frame or in any terminal scrollback. A live tunnel URL is an open door to the machine for as long as it is running.
- [ ] If a local server is used for any shot, it is on `127.0.0.1` and the address bar shows `127.0.0.1`, not a tunnel host.
- [ ] Nothing in this timeline needs a tunnel. If one is running, close it before recording.

## 6. Browser — bookmarks, tabs, profile, history

Shot 2a is the only browser shot, and one badly configured window undoes the whole video.

- [ ] Open a **new window in a fresh profile** (or a guest window). Not the daily-driver profile.
- [ ] **Bookmarks bar hidden.** Bookmark titles alone reveal other projects, employers and accounts.
- [ ] **Exactly one tab.** Tab titles are readable at 1080p.
- [ ] **No extension icons** in the toolbar — a wallet extension icon invites the question of what is in it.
- [ ] **Do not type in the address bar on camera.** Autocomplete will offer your history, mid-frame, and it is legible. **Paste the URL, or open it from a plain text file you have prepared.**
- [ ] No profile avatar, no signed-in account name in the corner.
- [ ] No notification popups, no "restore session" bar, no download shelf.
- [ ] The explorer page shows no logged-in state and no watchlist.

## 7. Wallet addresses

**Safe on camera** — public deployment addresses, already in the public repository and on the public
chain:

| Address | What it is |
|---|---|
| `0x11202071DA4EB91bE3041A174d0c20fdaC0Ea0C0` | the V1 hook |
| `0x044bc8a8773EC7b9B8de2467766636dFFCaC6210` | the V1 executor |
| `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b` | Uniswap's Sepolia Universal Router |
| `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | the official PoolManager |
| `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Circle's Sepolia USDC |
| `0x1120af18…ee0ecb83` | the settlement transaction hash |

**Keep out of frame:**

- [ ] **The deployer EOA.** It is the deployer, the order's recipient and a key the owner controls. It appears in the public repository, so showing it is not a *leak* — but do not put it on screen **next to a balance**, and never run `make balances` on camera.
- [ ] **Any address that is not in the table above**, unless you can say in one sentence what it is and why it is public. If you cannot, cut the frame.
- [ ] **Any wallet extension UI at all** — no MetaMask popup, no account list, no balance, no connected-sites panel. Nothing in this demo needs a wallet, because nothing in this demo signs.
- [ ] The ENSv2 live check prints the address a **third party's** name resolves to, and the resolver's address. Both are public contract state on Sepolia and are safe. Do not describe either as ours: **UNICA owns no ENS name.**

## 8. Anything else that is personal

- [ ] Desktop wallpaper, desktop icons, and the Dock are not visible — capture the window, not the screen, or hide the Dock.
- [ ] No file manager window showing other project directories.
- [ ] No calendar, mail, chat or messaging app in any frame, including for a single transition frame.
- [ ] Menu-bar clock and any menu-bar app that shows a name or a count are hidden or cropped out.
- [ ] The recording software's own overlay does not show a file path in a filename bar.

---

## The final pass

Watch the finished export **once through with the sound off**, at full screen, pausing on every
terminal frame and reading every line of every prompt, path, URL and address.

- [ ] Nothing from §1–§8 appears in any frame.
- [ ] Then step through the first and last two seconds of every cut, frame by frame. **Transitions
      are where a stray window shows for three frames** — long enough to pause on, short enough to
      miss at speed.
- [ ] The thumbnail and both cards contain no path, no address, no key. (They are hand-written SVG
      with no external reference of any kind; confirm you shipped those files and not a screenshot
      of something else.)
