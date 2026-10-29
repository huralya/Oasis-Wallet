# Oasis Wallet

A non-custodial Chrome extension for the Oasis Network, developed by [Huralya](https://huralya.com).

Oasis Wallet holds two accounts per wallet, one on each Oasis layer it supports: a **Sapphire** account with an EVM `0x...` address and a **Consensus** account with an `oasis1...` address. It can send on either layer and move ROSE between them.

## Consensus and Sapphire

Oasis has two layers that matter for ROSE:

| Layer | What it is | Address | Key |
| --- | --- | --- | --- |
| **Consensus** | The base layer: transfers, staking, and where most exchanges withdraw ROSE | `oasis1...` | Ed25519, ADR-0008 path `m/44'/474'/0'` |
| **Sapphire** | A confidential EVM ParaTime used by EVM wallets and dapps | `0x...` (EIP-55) | secp256k1, path `m/44'/60'/0'/0/0` |

The two layers have separate balances. ROSE only moves between them with a ParaTime deposit or withdrawal (see below), not with an ordinary transfer.

A Sapphire `0x` account also has an internal `oasis1` form inside the ParaTime. That string is **not** a Consensus address: its key is secp256k1, which cannot sign Consensus transactions, so ROSE sent to it on Consensus (for example from an exchange) cannot be moved by any wallet. Oasis Wallet therefore never offers it as an address to receive on. It is listed only in the wallet details under "Advanced", with a warning.

In short:

- Receiving from an exchange: use your **Consensus `oasis1`** address, then move to Sapphire if you need the ROSE there.
- Receiving from a Sapphire dapp or EVM wallet: use your **Sapphire `0x`** address.

## Moving ROSE between Consensus and Sapphire

The **To Sapphire** / **To Consensus** action moves ROSE between your own two accounts by default, or to another address of the destination layer's format. It follows the same protocol as the Oasis SDK, [Oasis Wallet Web](https://github.com/oasisprotocol/wallet) and the [Oasis CLI](https://github.com/oasisprotocol/cli) (`oasis account deposit` / `withdraw`):

- **Consensus → Sapphire (deposit).** If the Sapphire runtime does not yet have a large enough allowance, the wallet first sends a `staking.Allow` on Consensus for the missing amount (normal Consensus fee). It then signs a `consensus.Deposit` runtime transaction with the Consensus key. Sapphire takes the amount from your Consensus account using the allowance and credits the full amount to the destination `0x` address. Deposits are exempt from Sapphire's minimum gas price, so this step is free.
- **Sapphire → Consensus (withdrawal).** The wallet signs a `consensus.Withdraw` runtime transaction with the Sapphire key, always with an explicit `oasis1` destination. The network fee is paid from your Sapphire balance. If the Consensus transfer fails, Sapphire refunds the amount.

Amounts are entered with Consensus precision (9 decimals) because Sapphire uses 18 decimals and only multiples of 10^9 base units can cross to Consensus. The Consensus minimum transfer (currently 0.01 ROSE) applies. A move usually arrives within a minute; the wallet waits for the runtime's deposit or withdrawal event and shows whether it succeeded.

Some exchanges do not credit ROSE that arrives directly from Sapphire. The safer route is to move to your own Consensus account first and send from there.

## Features

- Sapphire and Consensus, Mainnet and Testnet, in one extension
- Sapphire `0x` and Consensus `oasis1` accounts, with the current layer and address format always visible
- Moves between Consensus and Sapphire (ParaTime deposit and withdrawal)
- Sends to `0x` addresses on Sapphire (EVM transfer) and to `oasis1` addresses on Consensus
- Full recipient address and every network fee shown on a review screen before signing
- EIP-55 checksum validation for `0x` recipients and strict bech32 validation for `oasis1` recipients
- Consensus sends refuse `oasis1` addresses known to belong to Sapphire `0x` accounts
- Receive screen with a locally generated QR code
- Live balance and activity from Oasis nodes and Oasis Nexus, with links to Oasis Explorer
- Multiple independent wallets, each with its own recovery phrase; rename and remove wallets
- Recovery phrase backup check during wallet creation
- Recovery phrase and private-key export behind password confirmation
- Configurable auto-lock (on close, 5, 15, 30 or 60 minutes)
- Light, dark and system themes, and an option to hide balances
- AES-256-GCM encrypted vault with PBKDF2-SHA256 (600,000 iterations)
- No analytics, telemetry or remote code; the BIP-39 wordlist ships with the extension
- Manifest V3 with a strict Content Security Policy and minimal permissions

## Install

### From a release

1. Download `oasis-wallet-vX.Y.Z.zip` from the [Releases](https://github.com/huralya/Oasis-Wallet/releases) page and extract it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted folder.

Each release includes a `.sha256` file to verify the download.

### From source

1. Clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the repository folder containing `manifest.json`.

Use Testnet first, including for moves between Consensus and Sapphire. Independent security review is recommended before storing material value.

## Project structure

```
manifest.json         Extension manifest
src/
  popup.html          Popup entry point
  app.js              Interface and screen logic
  chain.js            Sapphire RPC, Oasis gRPC-Web and Nexus access, transfers and moves
  crypto.js           Key derivation, addresses, signing, CBOR/RLP encoding, vault encryption
  store.js            Encrypted vault, preferences and auto-lock session
  networks.js         Network definitions and explorer links
  background.js       Auto-lock timer
  qr.js, icons.js     Local QR generator and interface icons
  styles.css          Styles and themes
  bip39-english.txt   BIP-39 English wordlist (verified by SHA-256)
assets/               Icons, logo and bundled Inter font
test/                 Known-answer tests and official Oasis test vectors
scripts/package.sh    Builds the release archive into dist/
```

## Tests

```
npm test
```

The tests use Node's built-in test runner (Node 22 or later) and have no dependencies. They check address derivation, `staking.Allow`, `consensus.Deposit` and `consensus.Withdraw` encoding and signatures byte for byte against official Oasis test vectors; each file in `test/vectors/` records its source.

## Building a release

```
./scripts/package.sh
```

This writes `dist/oasis-wallet-v<version>.zip` and its SHA-256 checksum, using the version from `manifest.json`. The archive contains only the extension files, not the tests.

## Security model

Recovery phrases and private keys never leave the device. They are stored only inside the encrypted vault in `chrome.storage.local`, encrypted with a key derived from the wallet password.

While the wallet is unlocked, the derived vault key is kept in `chrome.storage.session`, which lives in memory, is cleared when the browser closes and is not readable by web pages. The background worker clears it when the auto-lock timer expires. Recovery phrases are never written to session storage. Choosing **When the wallet closes** disables session storage entirely, so every opening of the extension requires the password.

Revealing a recovery phrase or private key, removing a wallet and changing the password always require the password again. Sensitive values copied to the clipboard are cleared after 30 seconds while the extension stays open.

The extension only talks to Oasis RPC, gRPC and Nexus endpoints, enforced through the Content Security Policy. Public addresses are sent to these services to read balances and activity and to submit signed transactions.

The extension requires Chrome 137 or later for native Ed25519 support in WebCrypto.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the changes in each release.

## Networks

- Sapphire Mainnet, chain ID `23294`
- Sapphire Testnet, chain ID `23295`
- Oasis Consensus Mainnet
- Oasis Consensus Testnet

## Open source and attribution

This project is licensed under the [Apache License 2.0](LICENSE).

It builds on public Oasis protocols, formats, documentation, and implementation patterns. The official Oasis ROSE Wallet project is available at https://github.com/oasisprotocol/wallet. The test vectors in `test/vectors/` come from the Apache-2.0 licensed [oasis-sdk](https://github.com/oasisprotocol/oasis-sdk) and oasis-core generators, as vendored by [Zondax/ledger-oasis](https://github.com/Zondax/ledger-oasis).

Oasis names and logos may be trademarks of their respective owners. See [Terms of Use](TERMS.md).

## Terms

Use of packaged builds is subject to [TERMS.md](TERMS.md). The source-code license remains Apache-2.0.
