# Oasis Wallet

A non-custodial Chrome extension for the Oasis Network, developed by [Huralya](https://huralya.com).

Oasis Wallet is designed around native `oasis1...` addresses while supporting both **Sapphire** and **Consensus** from a single browser extension. Sapphire accounts also expose their corresponding EVM `0x...` address when interoperability requires it.

## Features

- Sapphire and Consensus, Mainnet and Testnet, in one extension
- Native `oasis1...` addresses by default, with the matching EVM `0x...` address for Sapphire
- Send to Sapphire native addresses (`accounts.Transfer`), Sapphire EVM addresses and Consensus addresses
- Full recipient address and network fee shown on a review screen before signing
- EIP-55 checksum validation for `0x` recipients and strict bech32 validation for `oasis1` recipients
- Receive screen with locally generated QR codes for both address formats
- Live balance and activity from Oasis Nexus, with links to Oasis Explorer
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

Use Testnet first. Independent security review is recommended before storing material value.

## Project structure

```
manifest.json         Extension manifest
src/
  popup.html          Popup entry point
  app.js              Interface and screen logic
  chain.js            Sapphire RPC, Oasis gRPC-Web and Nexus access, transfers
  crypto.js           Key derivation, signing, CBOR/RLP encoding, vault encryption
  store.js            Encrypted vault, preferences and auto-lock session
  networks.js         Network definitions and explorer links
  background.js       Auto-lock timer
  qr.js, icons.js     Local QR generator and interface icons
  styles.css          Styles and themes
  bip39-english.txt   BIP-39 English wordlist (verified by SHA-256)
assets/               Icons, logo and bundled Inter font
scripts/package.sh    Builds the release archive into dist/
```

## Building a release

```
./scripts/package.sh
```

This writes `dist/oasis-wallet-v<version>.zip` and its SHA-256 checksum, using the version from `manifest.json`.

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

It builds on public Oasis protocols, formats, documentation, and implementation patterns. The official Oasis ROSE Wallet project is available at https://github.com/oasisprotocol/wallet.

Oasis names and logos may be trademarks of their respective owners. See [Terms of Use](TERMS.md).

## Terms

Use of packaged builds is subject to [TERMS.md](TERMS.md). The source-code license remains Apache-2.0.
