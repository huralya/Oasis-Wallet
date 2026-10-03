# Oasis Wallet

A non-custodial Chrome extension for the Oasis Network, developed by [Huralya](https://huralya.com).

Oasis Wallet is designed around native `oasis1...` addresses while supporting both **Sapphire** and **Consensus** from a single browser extension. Sapphire accounts also expose their corresponding EVM `0x...` address when interoperability requires it.

## Features

- Sapphire Mainnet and Testnet
- Consensus Mainnet and Testnet
- Native Oasis address shown by default
- Receive QR codes generated locally inside the extension
- Send to Sapphire native `oasis1...` addresses via `accounts.Transfer`
- Send to Sapphire EVM `0x...` addresses
- Consensus transfers
- Live network activity from Oasis Nexus
- Transaction links to Oasis Explorer
- Multiple independent wallets, each with its own recovery phrase
- Recovery phrase export after password verification
- Sapphire and Consensus private-key export after password verification
- Local password changes without a forced minimum length
- AES-256-GCM encrypted local vault using PBKDF2-SHA256
- No analytics or telemetry
- Manifest V3 with minimal permissions

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder containing `manifest.json`.

Use Testnet first. Independent security review is recommended before storing material value.

## Security model

Recovery phrases and private keys are never intentionally sent to Huralya. Wallet secrets are kept in memory only while the extension is unlocked and are persisted only inside the encrypted local vault. Sensitive exports require the wallet password again.

The extension necessarily sends public addresses and network requests to Oasis RPC/gRPC/Nexus infrastructure to retrieve balances, activity, and submit transactions.

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
