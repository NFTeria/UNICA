# Third-party licenses

UNICA's own code is MIT (`/LICENSE`). It builds on these libraries, vendored as git submodules under `lib/`. Their
license texts are copied here unchanged, as their licenses require.

| Library | Pinned commit | License | Text |
|---|---|---|---|
| Uniswap v4-periphery (`lib/uniswap-hooks/lib/v4-periphery`) | `7ebd04b161745b75ed0c24ba2df3bc7c25f65606` | MIT, Copyright 2023 Universal Navigation Inc. | [v4-periphery.LICENSE](v4-periphery.LICENSE) |
| Uniswap v4-core (`lib/uniswap-hooks/lib/v4-core`) | `d153b048868a60c2403a3ef5b2301bb247884d46` | Business Source License 1.1 for the core contracts, MIT for the files marked so; see the BUSL text for its change date | [v4-core.BUSL_LICENSE](v4-core.BUSL_LICENSE), [v4-core.MIT_LICENSE](v4-core.MIT_LICENSE) |
| OpenZeppelin uniswap-hooks (`lib/uniswap-hooks`) | `bd5287c4a9f5c22c2393f7587a9b357662916115` | MIT | [uniswap-hooks.LICENSE](uniswap-hooks.LICENSE) |
| hookmate (`lib/hookmate`) | as pinned in `.gitmodules` | **No license file in the repository** at the pinned commit: terms UNKNOWN. Used for test fixtures (the official v4 bytecode artifacts). Ask the author before shipping anything built from it. | — |
| forge-std (`lib/forge-std`) | as pinned in `.gitmodules` | MIT or Apache-2.0 | [forge-std.LICENSE-MIT](forge-std.LICENSE-MIT) |

UNICA does not deploy v4-core's contracts: its tests and scripts use the PoolManager that Uniswap deployed. Code that
imports v4-core interfaces and libraries keeps their license terms for those files.
