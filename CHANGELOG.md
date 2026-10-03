# Changelog

## 0.4.0

### Security

- The BIP-39 wordlist now ships with the extension and is verified by SHA-256 at load time. It is no longer downloaded from GitHub, and the `raw.githubusercontent.com` host permission has been removed.
- Content Security Policy tightened: `default-src 'none'`, network access restricted to Oasis endpoints, no inline styles, no framing.
- The review screen shows the full recipient address instead of a shortened one, so look-alike addresses can be spotted before signing.
- `0x` recipients are checked against their EIP-55 checksum, and the zero address is rejected.
- `oasis1` addresses are validated strictly (prefix, length, case and version byte).
- New passwords must be at least 8 characters, with a strength indicator.
- New wallets are saved only after the recovery phrase has been revealed and confirmed.
- Importing the same recovery phrase twice is rejected.
- Encrypted vaults with unsafe or malformed parameters are refused.
- Copied recovery phrases and private keys are cleared from the clipboard after 30 seconds while the extension stays open.
- Recovery phrases and private keys stay hidden until explicitly revealed.
- Network requests time out and never send credentials.

### Fixes

- Native Sapphire transfers used a gas price of 100 wei, below the network minimum. The fee is now based on the current Sapphire gas price.
- Consensus activity did not show amounts or direction because the indexer fields were read incorrectly.
- Consensus transfers now take the nonce from the node, so transfers sent in quick succession no longer fail because the indexer lags behind.
- Balance and activity responses from a previous network or wallet could overwrite the current view.
- The popup was taller than the 600px Chrome allows, which caused a scrollbar.
- The minimum Chrome version is raised to 137, the first release with Ed25519 enabled in WebCrypto. Older versions could not create or import wallets.
- gRPC errors returned in response headers are now reported instead of being ignored.

### Interface

- Complete visual redesign with light, dark and system themes.
- Wallets stay unlocked between openings according to a configurable auto-lock timer.
- Recovery phrase confirmation step during wallet creation.
- Receive screen with switchable Oasis and EVM address formats.
- Live recipient validation that shows which kind of transfer will be made.
- Activity shows labels for transfers, deposits, withdrawals, delegations and contract calls, and marks failed transactions.
- Wallets can be renamed and removed.
- Option to hide balances.
