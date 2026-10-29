# Changelog

## 0.5.0

### Address model

- Sapphire accounts are now shown only as their EIP-55 `0x` address: in the header, balance card, Receive screen, copy buttons, activity and explorer links. Previously the Receive screen defaulted to the `oasis1` form of the Sapphire account. ROSE sent to that `oasis1` string from an exchange or from Consensus lands on the Consensus layer at an address whose secp256k1 key cannot sign Consensus transactions, so it could not be moved.
- Consensus accounts keep their Ed25519 `oasis1` address (ADR-0008 path `m/44'/474'/0'`), unchanged.
- The current layer and its address format are shown on the balance card, Receive and Send screens. Receive explains which network may send to the address and points to "Move to Sapphire" for exchange withdrawals.
- The `oasis1` form of a Sapphire account is only listed under an "Advanced" section of the wallet details, with a warning never to send to it from an exchange or from Consensus.

### Sending

- Sapphire sends accept `0x` recipients only (EIP-55 checked). Native `accounts.Transfer` sends to `oasis1` addresses from Sapphire have been removed; an `oasis1` recipient on Sapphire now offers "Move to Consensus" instead.
- Consensus sends accept `oasis1` recipients only. A `0x` recipient on Consensus offers "Move to Sapphire" instead.
- Consensus sends refuse the `oasis1` form of the wallet's own Sapphire account, and any `oasis1` address that Oasis Nexus reports as the native form of a Sapphire `0x` account.

### Move between Consensus and Sapphire

- New "To Sapphire" / "To Consensus" action (ParaTime deposit and withdrawal), implemented as in the Oasis SDK, Oasis Wallet Web and the Oasis CLI:
  - Consensus → Sapphire: a `staking.Allow` for the Sapphire runtime's staking address when the existing allowance is not enough, then a `consensus.Deposit` runtime transaction signed by the Consensus Ed25519 key. Sapphire exempts deposits from its minimum gas price, so the deposit is free; the allowance transaction pays the normal Consensus fee.
  - Sapphire → Consensus: a `consensus.Withdraw` runtime transaction signed by the Sapphire key, with an explicit destination. The fee is paid from the Sapphire balance.
- The destination defaults to the same wallet's other account; another `0x` (deposit) or `oasis1` (withdrawal) address can be entered.
- Amounts use Consensus precision (9 decimals) so they are always representable on both layers, and the Consensus minimum transfer is enforced.
- The review screen shows both accounts, the amount, every fee, the estimated arrival time and warnings; the result is confirmed from the runtime's deposit or withdrawal event.

### Fixes

- The BIP-39 wordlist failed its integrity check when the repository was checked out with CRLF line endings (Git on Windows). Line endings are now normalized before hashing, and `.gitattributes` keeps text files LF so release archives built on Windows are correct.
- Consensus balances and nonces used before signing are read from the node, falling back to Nexus.

### Development

- `npm test` runs known-answer tests (Node's built-in test runner, no dependencies) against official Oasis test vectors for address derivation, `staking.Allow`, `consensus.Deposit` and `consensus.Withdraw` encoding and signatures.

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
