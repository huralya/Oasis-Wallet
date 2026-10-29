// Known-answer tests for address derivation, encoding and signing.
// Run with: node --test test/
// Vector sources are recorded in each test/vectors/*.json file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRuntimeTx,
  buildConsensusAccountsBody,
  buildStakingAllow,
  cborEncode,
  consensusSignatureContext,
  decodeOasisAddress,
  deriveAccounts,
  ed25519Address,
  ed25519FromSeed,
  evmToRuntimeAddress,
  isValidEvmAddress,
  runtimeChainContext,
  runtimeSignatureContext,
  runtimeStakingAddress,
  secp256k1PublicKey,
  signConsensusTx,
  signRuntimeTx,
  toChecksumAddress,
} from '../src/crypto.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./vectors/${name}`, import.meta.url)));
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const toB64 = (u) => Buffer.from(u).toString('base64');

test('Ed25519 address (runtime-sdk types/address.rs test_address_ed25519)', () => {
  const pk = b64('utrdHlX///////////////////////////////////8=');
  assert.equal(ed25519Address(pk), 'oasis1qryqqccycvckcxp453tflalujvlf78xymcdqw4vz');
});

test('0x -> ParaTime address (runtime-sdk test_address_from_eth)', () => {
  assert.equal(
    evmToRuntimeAddress('0xdce075e1c39b1ae0b75d554558b6451a226ffe00'),
    'oasis1qrk58a6j2qn065m6p06jgjyt032f7qucy5wqeqpt',
  );
});

test('runtime staking address (runtime-sdk test_address_from_runtime_id)', () => {
  assert.equal(
    runtimeStakingAddress('80000000000000002aff7f6dfb62720cfd735f2b037b81572fad1b7937d826b3'),
    'oasis1qpllh99nhwzrd56px4txvl26atzgg4f3a58jzzad',
  );
});

test('Sapphire runtime staking addresses (oasisprotocol/wallet src/config.ts)', () => {
  assert.equal(
    runtimeStakingAddress('000000000000000000000000000000000000000000000000f80306c9858e7279'),
    'oasis1qrd3mnzhhgst26hsp96uf45yhq6zlax0cuzdgcfc',
  );
  assert.equal(
    runtimeStakingAddress('000000000000000000000000000000000000000000000000a6d1e3ebf60dff6c'),
    'oasis1qqczuf3x6glkgjuf0xgtcpjjw95r3crf7y2323xd',
  );
});

test('runtime chain context (runtime-sdk crypto/signature/context.rs test_chain_context)', () => {
  const runtimeId = '8000000000000000000000000000000000000000000000000000000000000000';
  const consensus = '643fb06848be7e970af3b5b2d772eb8cfb30499c8162bc18ac03df2f5e22520e';
  assert.equal(
    runtimeChainContext(runtimeId, consensus),
    'ca4842870b97a6d5c0d025adce0b6a0dec94d2ba192ede70f96349cfbe3628b9',
  );
  assert.equal(
    runtimeSignatureContext(runtimeId, consensus),
    'oasis-runtime-sdk/tx: v0 for chain ca4842870b97a6d5c0d025adce0b6a0dec94d2ba192ede70f96349cfbe3628b9',
  );
});

test('oasis1 bech32 decoding is strict', () => {
  const ok = 'oasis1qryqqccycvckcxp453tflalujvlf78xymcdqw4vz';
  assert.equal(decodeOasisAddress(ok).length, 21);
  assert.equal(decodeOasisAddress(ok.toUpperCase()).length, 21);
  for (const bad of [
    ok.slice(0, -1) + 'x', // checksum
    ok.slice(0, -1), // length
    'oasis1Qryqqccycvckcxp453tflalujvlf78xymcdqw4vz', // mixed case
    'cosmos1qryqqccycvckcxp453tflalujvlf78xymcdqw4vz', // prefix
  ])
    assert.throws(() => decodeOasisAddress(bad));
});

test('EIP-55 checksums (EIP-55 specification examples)', () => {
  for (const a of [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ]) {
    assert.equal(toChecksumAddress(a.toLowerCase()), a);
    assert.ok(isValidEvmAddress(a));
  }
  assert.ok(!isValidEvmAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'));
});

test('ADR-0008 Consensus key derivation (oasis-sdk adr-0008-vectors.json)', async () => {
  for (const v of load('adr-0008.json').vectors) {
    const accounts = await deriveAccounts(v.mnemonic);
    assert.equal(accounts.consensus, v.address, v.mnemonic);
  }
});

test('Sapphire 0x derivation (BIP-44 m/44\'/60\'/0\'/0/0, well-known test mnemonic)', async () => {
  // Public development mnemonic used by Hardhat and Foundry.
  const accounts = await deriveAccounts('test test test test test test test test test test test junk');
  assert.equal(accounts.eth, '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.equal(accounts.sapphireNative, evmToRuntimeAddress(accounts.eth));
});

test('staking.Allow encoding and signature (oasis-core gen_vectors)', async () => {
  const { vectors } = load('staking-allow.json');
  assert.ok(vectors.length > 0);
  for (const v of vectors) {
    const tx = buildStakingAllow({
      beneficiary: v.tx.body.beneficiary,
      amountChange: BigInt(v.tx.body.amount_change),
      negative: !!v.tx.body.negative,
      nonce: BigInt(v.tx.nonce),
      gas: BigInt(v.tx.fee.gas),
      feeAmount: BigInt(v.tx.fee.amount),
    });
    assert.equal(toB64(cborEncode(tx)), v.encoded_tx);
    const chainContext = v.signature_context.split(' for chain ')[1];
    assert.equal(consensusSignatureContext(chainContext), v.signature_context);
    const signer = await ed25519FromSeed(b64(v.signer_private_key).slice(0, 32));
    assert.equal(toB64(signer.publicKey), v.signer_public_key);
    const signed = await signConsensusTx(tx, signer, chainContext);
    assert.equal(toB64(signed.encoded), v.encoded_signed_tx);
  }
});

test('consensus.Deposit / consensus.Withdraw encoding and signature (oasis-sdk gen_runtime_vectors)', async () => {
  const { vectors } = load('runtime-consensus-accounts.json');
  const counts = {};
  for (const v of vectors) {
    const fee = v.tx.ai.fee;
    // The wallet only uses the native denomination (empty string); skip the
    // generator's "FOO" fee-denomination variants.
    if (fee.amount.Denomination !== '' || v.tx.call.body.amount.Denomination !== '') continue;
    const key = b64(v.signer_private_key);
    const isEd = v.scheme === 'ed25519';
    const signerKey = isEd ? await ed25519FromSeed(key.slice(0, 32)) : null;
    const publicKey = isEd ? signerKey.publicKey : secp256k1PublicKey(key);
    assert.equal(toB64(publicKey), v.signer_public_key);
    if (v.meta.orig_to)
      assert.equal(evmToRuntimeAddress(`0x${v.meta.orig_to}`), v.tx.call.body.to);
    const tx = buildRuntimeTx({
      method: v.method,
      body: buildConsensusAccountsBody({
        to: v.tx.call.body.to,
        amount: BigInt(v.tx.call.body.amount.Amount),
      }),
      signer: { [v.scheme]: publicKey },
      nonce: BigInt(v.tx.ai.si[0].nonce),
      gas: BigInt(fee.gas || 0),
      feeAmount: BigInt(fee.amount.Amount),
      consensusMessages: fee.consensus_messages || 0,
    });
    assert.equal(toB64(cborEncode(tx)), v.encoded_tx, `${v.method} ${v.scheme} encoding`);
    assert.equal(runtimeSignatureContext(v.meta.runtime_id, v.meta.chain_context), v.sig_context);
    const signed = await signRuntimeTx(
      tx,
      isEd ? { ed25519: signerKey } : { secp256k1: key },
      v.meta.runtime_id,
      v.meta.chain_context,
    );
    assert.equal(toB64(signed.encoded), v.encoded_signed_tx, `${v.method} ${v.scheme} signature`);
    counts[`${v.method} ${v.scheme}`] = (counts[`${v.method} ${v.scheme}`] || 0) + 1;
  }
  assert.ok(counts['consensus.Deposit ed25519'] > 0);
  assert.ok(counts['consensus.Withdraw secp256k1eth'] > 0);
});
