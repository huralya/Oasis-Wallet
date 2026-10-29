import {
  ADDRESS_CONTEXT_SECP256K1ETH,
  buildConsensusAccountsBody,
  buildConsensusTransfer,
  buildRuntimeTx,
  buildStakingAllow,
  cborEncode,
  cborDecode,
  decodeOasisAddress,
  evmToRuntimeAddress,
  fromHex,
  getConsensusPublicKey,
  getSignerSpecs,
  hex,
  isValidEvmAddress,
  isEvmAddress,
  runtimeStakingAddress,
  signConsensusDeposit,
  signConsensusTransfer,
  signConsensusWithdraw,
  signLegacyTransfer,
  signStakingAllow,
  toChecksumAddress,
} from './crypto.js';
import { NETWORKS, explorerTxUrl, pairedNetwork } from './networks.js';

const REQUEST_TIMEOUT = 20000;
const SUBMIT_TIMEOUT = 60000;
const SAPPHIRE_MIN_GAS_PRICE = 100000000000n; // 100 gwei, Sapphire genesis min_gas_price
const EVM_TRANSFER_RESERVE_GAS = 30000n;
const ROUND_LATEST = 0xffffffffffffffffn;
const HEIGHT_LATEST = 0;

// Sapphire uses 18 decimals, Consensus 9. The consensus module's
// `consensus_scaling_factor` is 10^9, and `amount_to_consensus` rejects any
// ParaTime amount that is not a multiple of it (AmountNotRepresentable).
// https://github.com/oasisprotocol/sapphire-paratime/blob/main/runtime/src/lib.rs
// https://github.com/oasisprotocol/oasis-sdk/blob/main/runtime-sdk/src/modules/consensus/mod.rs
export const CONSENSUS_DECIMALS = 9;
export const SCALING_FACTOR = 10n ** 9n;

// Runtime gas: the Oasis CLI estimates with `core.EstimateGas` and adds 20%
// (cli/cmd/common/transaction.go). On Sapphire Testnet that gives ~73,600 gas for
// both consensus.Deposit and consensus.Withdraw (cli/examples/account/*.y.out).
// The fallback is only used if estimation fails and stays above that figure.
const RUNTIME_GAS_MARGIN = 120n;
const MOVE_GAS_FALLBACK = 80000n;

class NetworkError extends Error {}

async function request(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new NetworkError('The network did not respond in time.');
    throw new NetworkError('Network unavailable. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

// --- Sapphire JSON-RPC ---

let rpcId = 0;
export async function rpcCall(net, method, params = [], timeout) {
  const response = await request(
    net.rpc,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    },
    timeout,
  );
  if (!response.ok) throw new NetworkError(`RPC request failed (${response.status}).`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || `RPC error ${json.error.code}`);
  return json.result;
}

const toRpcHex = (n) => `0x${BigInt(n).toString(16)}`;

async function sapphireGasPrice(net) {
  try {
    const price = BigInt(await rpcCall(net, 'eth_gasPrice'));
    return price > SAPPHIRE_MIN_GAS_PRICE ? price : SAPPHIRE_MIN_GAS_PRICE;
  } catch {
    return SAPPHIRE_MIN_GAS_PRICE;
  }
}

// --- Oasis gRPC-Web ---

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

// gRPC-Web text responses may contain several independently padded base64 chunks.
function base64ToBytes(text) {
  const clean = text.replace(/\s+/g, ''),
    chunks = [];
  const decode = (part) => Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '=') continue;
    if (clean[i + 1] === '=') i++;
    chunks.push(decode(clean.slice(start, i + 1)));
    start = i + 1;
  }
  if (start < clean.length) {
    const part = clean.slice(start);
    chunks.push(decode(part + '='.repeat((4 - (part.length % 4)) % 4)));
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function grpcFrame(payload) {
  const out = new Uint8Array(5 + payload.length);
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

function parseGrpcFrames(bytes) {
  const frames = [];
  let status = 0,
    message = '';
  for (let off = 0; off + 5 <= bytes.length;) {
    const flag = bytes[off],
      len = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 4).getUint32(0, false);
    off += 5;
    if (off + len > bytes.length) throw new Error('Malformed gRPC-Web response.');
    const payload = bytes.slice(off, off + len);
    off += len;
    if (!(flag & 0x80)) {
      frames.push(payload);
      continue;
    }
    for (const line of new TextDecoder().decode(payload).split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase(),
        value = line.slice(idx + 1).trim();
      if (key === 'grpc-status') status = Number(value || 0);
      if (key === 'grpc-message') {
        try {
          message = decodeURIComponent(value);
        } catch {
          message = value;
        }
      }
    }
  }
  if (status !== 0) throw new Error(message || `Oasis node error ${status}.`);
  return frames;
}

async function grpcUnary(net, service, method, body, timeout) {
  const payload = body == null ? new Uint8Array() : cborEncode(body);
  const response = await request(
    `${net.grpc}/oasis-core.${service}/${method}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/grpc-web-text',
        accept: 'application/grpc-web-text',
        'x-grpc-web': '1',
      },
      body: bytesToBase64(grpcFrame(payload)),
    },
    timeout,
  );
  if (!response.ok) throw new NetworkError(`Oasis node request failed (${response.status}).`);
  // Errors can also arrive in the HTTP headers of a trailers-only response.
  const headerStatus = Number(response.headers.get('grpc-status') || 0);
  if (headerStatus) {
    const msg = response.headers.get('grpc-message');
    throw new Error(msg ? decodeURIComponent(msg) : `Oasis node error ${headerStatus}.`);
  }
  const ct = response.headers.get('content-type') || '',
    bytes = ct.includes('grpc-web-text')
      ? base64ToBytes(await response.text())
      : new Uint8Array(await response.arrayBuffer()),
    frames = parseGrpcFrames(bytes);
  if (!frames.length || !frames[0].length) return undefined;
  return cborDecode(frames[0]);
}

const quantity = (v) => {
  if (v == null) return 0n;
  if (v instanceof Uint8Array)
    return v.length
      ? BigInt('0x' + [...v].map((b) => b.toString(16).padStart(2, '0')).join(''))
      : 0n;
  return BigInt(v);
};

// --- ParaTime queries (RuntimeClient.Query) ---

async function runtimeQuery(net, method, args) {
  const response = await grpcUnary(net, 'RuntimeClient', 'Query', {
    runtime_id: fromHex(net.runtimeId),
    round: ROUND_LATEST,
    method,
    args: cborEncode(args ?? null),
  });
  return response?.data ? cborDecode(response.data) : undefined;
}

async function runtimeNonce(net, address) {
  return BigInt((await runtimeQuery(net, 'accounts.Nonce', { address: decodeOasisAddress(address) })) ?? 0);
}

// core.MinGasPrice returns {denomination: price}; the native denomination is ''.
// Sapphire's minimum is dynamic, so it is read live (as the Oasis CLI does).
async function runtimeGasPrice(net) {
  try {
    const prices = await runtimeQuery(net, 'core.MinGasPrice');
    const price = quantity(prices?.['']);
    if (price > 0n) return price > SAPPHIRE_MIN_GAS_PRICE ? price : SAPPHIRE_MIN_GAS_PRICE;
  } catch {}
  return sapphireGasPrice(net);
}

async function runtimeEstimateGas(net, tx) {
  try {
    const gas = BigInt((await runtimeQuery(net, 'core.EstimateGas', { tx })) ?? 0);
    if (gas > 0n) return (gas * RUNTIME_GAS_MARGIN + 99n) / 100n;
  } catch {}
  return MOVE_GAS_FALLBACK;
}

async function submitRuntimeTx(net, encoded) {
  const response = await grpcUnary(
    net,
    'RuntimeClient',
    'SubmitTx',
    { runtime_id: fromHex(net.runtimeId), data: encoded },
    SUBMIT_TIMEOUT,
  );
  if (response instanceof Uint8Array && response.length) {
    const result = cborDecode(response);
    if (result?.fail) {
      const f = result.fail;
      throw new Error(
        f.message || `The Sapphire transaction was rejected (${f.module || 'runtime'} error ${f.code}).`,
      );
    }
  }
}

// --- Consensus queries ---

async function consensusNonce(net, address, fallback = 0n) {
  let nonce = fallback;
  try {
    // The indexer can lag a block or two behind; prefer the node's view.
    const live = await grpcUnary(net, 'Consensus', 'GetSignerNonce', {
      account_address: decodeOasisAddress(address),
      height: HEIGHT_LATEST,
    });
    if (live != null && BigInt(live) > nonce) nonce = BigInt(live);
  } catch {}
  return nonce;
}

async function consensusFee(net, publicKey, draft) {
  const gas = quantity(
    await grpcUnary(net, 'Consensus', 'EstimateGas', { signer: publicKey, transaction: draft }),
  );
  if (gas <= 0n) throw new Error('Could not estimate the network fee. Try again.');
  const minGasPrice = quantity(await grpcUnary(net, 'Consensus', 'MinGasPrice', undefined));
  return { gas, fee: minGasPrice * gas };
}

async function consensusAllowance(net, owner, beneficiary) {
  return quantity(
    await grpcUnary(net, 'Staking', 'Allowance', {
      height: HEIGHT_LATEST,
      owner: decodeOasisAddress(owner),
      beneficiary: decodeOasisAddress(beneficiary),
    }),
  );
}

// staking `min_transfer` applies to both the deposit's `staking.Withdraw` and
// the withdrawal's `staking.Transfer` (oasis-core apps/staking/transactions.go).
async function consensusMinTransfer(net) {
  try {
    const params = await grpcUnary(net, 'Staking', 'ConsensusParameters', HEIGHT_LATEST);
    return quantity(params?.min_transfer);
  } catch {
    return 0n;
  }
}

// --- Nexus indexer ---

async function nexusJson(url) {
  const response = await request(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new NetworkError(`Indexer request failed (${response.status}).`);
  return response.json();
}

async function consensusAccount(net, address) {
  const json = await nexusJson(`${net.nexus}/consensus/accounts/${encodeURIComponent(address)}`);
  return { available: BigInt(json?.available || '0'), nonce: BigInt(json?.nonce || 0) };
}

// Balance and nonce from the node itself (Staking.Account), falling back to the
// indexer. Used before signing, where a lagging indexer must not decide.
async function liveConsensusAccount(net, address) {
  try {
    const account = await grpcUnary(net, 'Staking', 'Account', {
      height: HEIGHT_LATEST,
      owner: decodeOasisAddress(address),
    });
    if (account) {
      const general = account.general || {};
      return { available: quantity(general.balance), nonce: BigInt(general.nonce ?? 0) };
    }
  } catch {}
  return consensusAccount(net, address);
}

// If Nexus knows that an oasis1 address is the native form of a Sapphire 0x
// account, returns that 0x address. Such an address has a secp256k1 key and
// cannot sign on Consensus: ROSE sent to it there is stuck. Best effort only:
// unknown addresses return null.
export async function knownEvmOwner(net, address) {
  try {
    const json = await nexusJson(
      `${net.nexus}/sapphire/accounts/${encodeURIComponent(address)}`,
    );
    const p = json?.address_preimage;
    if (p?.context !== ADDRESS_CONTEXT_SECP256K1ETH || !p.address_data) return null;
    const bytes = Uint8Array.from(atob(p.address_data), (c) => c.charCodeAt(0));
    return bytes.length === 20 ? toChecksumAddress('0x' + hex(bytes)) : null;
  } catch {
    return null;
  }
}

export async function fetchBalance(net, accounts) {
  if (net.kind === 'sapphire')
    return BigInt(await rpcCall(net, 'eth_getBalance', [accounts.eth, 'latest']));
  return (await liveConsensusAccount(net, accounts.consensus)).available;
}

const TX_LABELS = {
  'staking.Transfer': null,
  'accounts.Transfer': null,
  'staking.AddEscrow': 'Delegated',
  'staking.ReclaimEscrow': 'Undelegated',
  'staking.Allow': 'Allowance',
  'staking.Withdraw': 'Withdrawal',
  'staking.Burn': 'Burn',
  'consensus.Deposit': 'Moved from Consensus',
  'consensus.Withdraw': 'Moved to Consensus',
  'consensus.Delegate': 'Delegated',
  'consensus.Undelegate': 'Undelegated',
  'evm.Create': 'Contract deployment',
  'roothash.SubmitMsg': 'Runtime message',
};

function parseActivity(net, accounts, tx) {
  const ours = [accounts.sapphireNative, accounts.eth, accounts.consensus]
    .filter(Boolean)
    .map((x) => x.toLowerCase());
  const isOurs = (x) => !!x && ours.includes(String(x).toLowerCase());
  const consensus = net.kind === 'consensus';
  const method = tx.method || '';
  // On Sapphire, show the 0x form of an account whenever Nexus knows it.
  const sender = consensus ? tx.sender : tx.sender_0_eth || tx.sender_0;
  const to = consensus ? tx.body?.to || tx.body?.account : tx.to_eth || tx.to;
  const outgoing = isOurs(sender) || isOurs(tx.sender_0);
  const incoming = isOurs(to) || isOurs(tx.to);

  let rawAmount = consensus ? tx.body?.amount : tx.amount;
  if (!consensus && tx.amount_symbol && tx.amount_symbol !== net.symbol) rawAmount = null;
  let amount = null;
  try {
    if (rawAmount != null && rawAmount !== '') amount = BigInt(rawAmount);
  } catch {}

  let direction = 'other',
    label = TX_LABELS[method];
  const isTransfer =
    method === 'staking.Transfer' ||
    method === 'accounts.Transfer' ||
    (method === 'evm.Call' && tx.is_likely_native_token_transfer);
  if (isTransfer) {
    direction =
      outgoing && !incoming ? 'out' : incoming && !outgoing ? 'in' : outgoing ? 'self' : 'other';
    label = { out: 'Sent', in: 'Received', self: 'Sent to self', other: 'Transfer' }[direction];
  } else if (method === 'consensus.Deposit') {
    direction = 'in';
  } else if (
    method === 'consensus.Withdraw' ||
    method === 'staking.AddEscrow' ||
    method === 'consensus.Delegate'
  ) {
    direction = 'out';
  } else if (method === 'evm.Call') {
    label = 'Contract call';
    direction = outgoing ? 'out' : 'other';
  }
  if (!label)
    label = method
      ? method
          .split('.')
          .pop()
          .replace(/([a-z])([A-Z])/g, '$1 $2')
      : 'Transaction';

  const counterparty = direction === 'in' ? sender : to;
  const hash = String(tx.eth_hash || tx.hash || '');
  const time = tx.timestamp ? new Date(tx.timestamp) : null;
  return {
    hash,
    label,
    direction,
    amount: amount && amount > 0n ? amount : null,
    counterparty: counterparty && !isOurs(counterparty) ? String(counterparty) : '',
    failed: tx.success === false,
    time: time && !Number.isNaN(time.valueOf()) ? time : null,
    url: /^(0x)?[0-9a-fA-F]{64}$/.test(hash) ? explorerTxUrl(net, hash) : null,
  };
}

export async function fetchActivity(net, accounts, limit = 20) {
  const rel = net.kind === 'sapphire' ? accounts.sapphireNative : accounts.consensus;
  const path = net.kind === 'sapphire' ? 'sapphire/transactions' : 'consensus/transactions';
  const json = await nexusJson(
    `${net.nexus}/${path}?rel=${encodeURIComponent(rel)}&limit=${limit}`,
  );
  const list = json?.transactions || [];
  return list.map((tx) => parseActivity(net, accounts, tx)).filter((x) => x.hash);
}

// --- Transfers ---
// Sapphire sends go to 0x addresses only (EVM transfer). Consensus sends go to
// oasis1 addresses only. An address of the other layer's format is routed to
// "Move" instead: on Sapphire an oasis1 destination means a withdrawal to
// Consensus, on Consensus a 0x destination means a deposit to Sapphire.

export function recipientRoute(net, to) {
  const value = String(to || '').trim();
  if (!value) return null;
  if (/^oasis1/i.test(value)) return net.kind === 'sapphire' ? 'move' : 'consensus';
  if (/^0x/i.test(value)) return net.kind === 'sapphire' ? 'evm' : 'move';
  return 'invalid';
}

export function validateRecipient(net, accounts, to) {
  const route = recipientRoute(net, to);
  if (!route) throw new Error('Enter a recipient address.');
  if (route === 'invalid')
    throw new Error(
      net.kind === 'sapphire'
        ? 'Sapphire sends need a 0x… address.'
        : 'Consensus sends need an oasis1… address.',
    );
  if (route === 'move')
    throw new Error(
      net.kind === 'sapphire'
        ? 'oasis1… addresses are on Consensus. Use “Move to Consensus” to send ROSE there.'
        : '0x… addresses are on Sapphire. Use “Move to Sapphire” to send ROSE there.',
    );
  if (route === 'evm') {
    if (!isEvmAddress(to)) throw new Error('That 0x address is not 40 hex characters long.');
    if (!isValidEvmAddress(to)) throw new Error('Address checksum is invalid. Check for typos.');
    if (to.toLowerCase() === accounts.eth.toLowerCase())
      throw new Error('You cannot send to this same wallet.');
    if (/^0x0{40}$/i.test(to))
      throw new Error('Sending to the zero address would burn your tokens.');
  } else {
    try {
      decodeOasisAddress(to);
    } catch {
      throw new Error('That oasis1 address is not valid. Check for typos.');
    }
    if (to.toLowerCase() === accounts.consensus.toLowerCase())
      throw new Error('You cannot send to this same wallet.');
    if (to.toLowerCase() === accounts.sapphireNative.toLowerCase())
      throw new Error(
        'That is the native form of your Sapphire 0x account. ROSE sent to it on Consensus cannot be recovered. Use “Move to Sapphire” instead.',
      );
  }
  return route;
}

const STUCK_ADDRESS_ERROR = (evm) =>
  `This oasis1 address belongs to the Sapphire account ${evm}. Its key cannot sign on Consensus, so ROSE sent there would be stuck. Ask the recipient for a Consensus address, or use “Move to Sapphire” to send to ${evm}.`;

export async function estimateMaxSendable(net, balance) {
  if (!balance || balance <= 0n) return 0n;
  let reserve = 0n;
  if (net.kind === 'sapphire') reserve = (await sapphireGasPrice(net)) * EVM_TRANSFER_RESERVE_GAS;
  return balance > reserve ? balance - reserve : 0n;
}

export async function prepareTransfer({ net, accounts, mnemonic, to, amount }) {
  to = String(to).trim();
  const route = validateRecipient(net, accounts, to);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  const base = { network: net.key, mode: route, to, amount };

  if (route === 'evm') {
    const [nonceHex, gasPrice, balance] = await Promise.all([
      rpcCall(net, 'eth_getTransactionCount', [accounts.eth, 'pending']),
      sapphireGasPrice(net),
      fetchBalance(net, accounts),
    ]);
    const estimate = BigInt(
      await rpcCall(net, 'eth_estimateGas', [{ from: accounts.eth, to, value: toRpcHex(amount) }]),
    );
    const gasLimit = estimate < 21000n ? 21000n : (estimate * 120n + 99n) / 100n,
      fee = gasPrice * gasLimit;
    if (amount + fee > balance)
      throw new Error(`Insufficient ${net.symbol} to cover the amount and network fee.`);
    return {
      ...base,
      from: accounts.eth,
      fee,
      nonce: BigInt(nonceHex),
      gasPrice,
      gasLimit,
      balance,
    };
  }

  const evmOwner = await knownEvmOwner(net, to);
  if (evmOwner) throw new Error(STUCK_ADDRESS_ERROR(evmOwner));
  const account = await liveConsensusAccount(net, accounts.consensus);
  const nonce = await consensusNonce(net, accounts.consensus, account.nonce);
  if (amount > account.available) throw new Error(`Insufficient ${net.symbol}.`);
  const publicKey = await getConsensusPublicKey(mnemonic);
  const { gas, fee } = await consensusFee(
    net,
    publicKey,
    buildConsensusTransfer({ to, amount, nonce, gas: 0n }),
  );
  if (amount + fee > account.available)
    throw new Error(`Insufficient ${net.symbol} to cover the amount and network fee.`);
  return { ...base, from: accounts.consensus, fee, nonce, gas, balance: account.available };
}

export async function submitTransfer(net, pending, mnemonic) {
  const p = pending;
  if (p.mode === 'evm') {
    const signed = await signLegacyTransfer({
      mnemonic,
      to: p.to,
      value: p.amount,
      nonce: p.nonce,
      gasPrice: p.gasPrice,
      gasLimit: p.gasLimit,
      chainId: net.chainId,
    });
    const hash = await rpcCall(net, 'eth_sendRawTransaction', [signed.raw], SUBMIT_TIMEOUT);
    return hash || signed.hash;
  }
  if (p.mode !== 'consensus') throw new Error('Unsupported transfer.');
  const signed = await signConsensusTransfer({
    mnemonic,
    to: p.to,
    amount: p.amount,
    nonce: p.nonce,
    gas: p.gas,
    feeAmount: p.fee,
    chainContext: net.chainContext,
  });
  await grpcUnary(net, 'Consensus', 'SubmitTx', signed.signed, SUBMIT_TIMEOUT);
  return signed.txHash;
}

// --- Move between Consensus and Sapphire (ParaTime deposit / withdraw) ---
//
// Implemented as in the official tools:
// - oasis-sdk runtime-sdk/src/modules/consensus_accounts (consensus.Deposit /
//   consensus.Withdraw), client-sdk/ts-web/rt/src/consensus_accounts.ts
// - Oasis Wallet Web, src/app/state/transaction/saga.ts (setAllowance,
//   submitParaTimeTransaction) and src/app/lib/transaction.ts
// - Oasis CLI, cmd/account/deposit.go and withdraw.go
//
// Consensus -> Sapphire (deposit):
//   1. `staking.Allow` on Consensus for the Sapphire runtime's staking address,
//      for the missing allowance only (as Oasis Wallet Web does). Fee from the
//      Consensus balance.
//   2. Runtime tx `consensus.Deposit {to, amount}` signed by the Consensus
//      Ed25519 key and submitted to Sapphire. Sapphire lists consensus.Deposit
//      in MIN_GAS_PRICE_EXEMPT_METHODS, so it is sent with a zero fee like Oasis
//      Wallet Web and `oasis account deposit --gas-price 0`. The signer usually
//      has no Sapphire balance, so a non-zero fee could not be paid anyway.
//   3. Sapphire emits a `staking.Withdraw` consensus message using the
//      allowance; when it succeeds the full amount is minted to `to` and a
//      consensus_accounts Deposit event (from, nonce) is emitted.
// Sapphire -> Consensus (withdraw):
//   1. Runtime tx `consensus.Withdraw {to, amount}` signed by the Sapphire
//      secp256k1 key, fee = gas x min gas price paid from the Sapphire balance.
//   2. The runtime emits a `staking.Transfer` to `to`; on failure the amount is
//      refunded. A Withdraw event (from, nonce) reports the outcome.

export const moveDirection = (net) => (net.kind === 'consensus' ? 'deposit' : 'withdraw');

export function validateMoveDestination(net, accounts, to) {
  const value = String(to || '').trim();
  if (!value) throw new Error('Enter a destination address.');
  if (moveDirection(net) === 'deposit') {
    if (/^oasis1/i.test(value))
      throw new Error('Moves to Sapphire go to a 0x… address. oasis1… addresses are on Consensus.');
    if (!isEvmAddress(value)) throw new Error('Enter a Sapphire 0x… address.');
    if (!isValidEvmAddress(value)) throw new Error('Address checksum is invalid. Check for typos.');
    if (/^0x0{40}$/i.test(value))
      throw new Error('Sending to the zero address would burn your tokens.');
    return value;
  }
  if (/^0x/i.test(value))
    throw new Error('Moves to Consensus go to an oasis1… address. 0x… addresses are on Sapphire.');
  try {
    decodeOasisAddress(value);
  } catch {
    throw new Error('That oasis1 address is not valid. Check for typos.');
  }
  if (value.toLowerCase() === accounts.sapphireNative.toLowerCase())
    throw new Error(
      'That is the native form of your Sapphire 0x account, not a Consensus account. ROSE sent there would be stuck.',
    );
  return value;
}

function depositEstimateTx(specs, to, runtimeAmount, nonce) {
  return buildRuntimeTx({
    method: 'consensus.Deposit',
    body: buildConsensusAccountsBody({ to, amount: runtimeAmount }),
    signer: specs.consensus,
    nonce,
    consensusMessages: 1,
  });
}

function withdrawEstimateTx(specs, to, runtimeAmount, nonce) {
  return buildRuntimeTx({
    method: 'consensus.Withdraw',
    body: buildConsensusAccountsBody({ to, amount: runtimeAmount }),
    signer: specs.sapphire,
    nonce,
    consensusMessages: 1,
  });
}

export async function prepareMove({ net, accounts, mnemonic, to, amount }) {
  const target = pairedNetwork(net),
    direction = moveDirection(net),
    destination = validateMoveDestination(net, accounts, to);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  const runtimeAmount = amount * SCALING_FACTOR;
  const sapphire = direction === 'deposit' ? target : net;
  const consensus = direction === 'deposit' ? net : target;
  const [specs, minTransfer] = await Promise.all([
    getSignerSpecs(mnemonic),
    consensusMinTransfer(consensus),
  ]);
  if (minTransfer > 0n && amount < minTransfer)
    throw new Error(
      `The minimum amount is ${formatConsensus(minTransfer)} ${net.symbol} (Consensus minimum transfer).`,
    );
  const base = {
    kind: 'move',
    direction,
    network: net.key,
    target: target.key,
    amount,
    runtimeAmount,
    minTransfer,
  };

  if (direction === 'deposit') {
    const toNative = evmToRuntimeAddress(destination);
    const beneficiary = runtimeStakingAddress(sapphire.runtimeId);
    const account = await liveConsensusAccount(net, accounts.consensus);
    const [nonce, allowance, runtimeNonceValue] = await Promise.all([
      consensusNonce(net, accounts.consensus, account.nonce),
      consensusAllowance(net, accounts.consensus, beneficiary),
      runtimeNonce(sapphire, accounts.consensus),
    ]);
    let allow = null;
    if (allowance < amount) {
      const amountChange = amount - allowance;
      const { gas, fee } = await consensusFee(
        net,
        specs.consensus.ed25519,
        buildStakingAllow({ beneficiary, amountChange, nonce, gas: 0n }),
      );
      allow = { beneficiary, amountChange, nonce, gas, fee };
    }
    const consensusFeeTotal = allow ? allow.fee : 0n;
    if (amount + consensusFeeTotal > account.available)
      throw new Error(
        `Insufficient ${net.symbol} on Consensus to cover the amount${allow ? ' and the allowance fee' : ''}.`,
      );
    const runtimeGas = await runtimeEstimateGas(
      sapphire,
      depositEstimateTx(specs, toNative, runtimeAmount, runtimeNonceValue),
    );
    return {
      ...base,
      from: accounts.consensus,
      to: destination,
      toNative,
      ownDestination: destination.toLowerCase() === accounts.eth.toLowerCase(),
      allowance,
      allow,
      consensusFee: consensusFeeTotal,
      runtimeFee: 0n,
      runtimeGas,
      runtimeNonce: runtimeNonceValue,
      balance: account.available,
    };
  }

  const evmOwner = await knownEvmOwner(net, destination);
  if (evmOwner) throw new Error(STUCK_ADDRESS_ERROR(evmOwner));
  const [nonce, gasPrice, balance] = await Promise.all([
    runtimeNonce(net, accounts.sapphireNative),
    runtimeGasPrice(net),
    fetchBalance(net, accounts),
  ]);
  const runtimeGas = await runtimeEstimateGas(
    net,
    withdrawEstimateTx(specs, destination, runtimeAmount, nonce),
  );
  const runtimeFee = runtimeGas * gasPrice;
  if (runtimeAmount + runtimeFee > balance)
    throw new Error(`Insufficient ${net.symbol} on Sapphire to cover the amount and network fee.`);
  return {
    ...base,
    from: accounts.eth,
    fromNative: accounts.sapphireNative,
    to: destination,
    ownDestination: destination.toLowerCase() === accounts.consensus.toLowerCase(),
    consensusFee: 0n,
    runtimeFee,
    runtimeGas,
    gasPrice,
    runtimeNonce: nonce,
    balance,
  };
}

function formatConsensus(v) {
  const whole = v / SCALING_FACTOR,
    frac = (v % SCALING_FACTOR).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Largest amount (Consensus base units) that can be moved from `net`.
export async function estimateMaxMove({ net, accounts, mnemonic }) {
  const target = pairedNetwork(net);
  if (moveDirection(net) === 'deposit') {
    const account = await liveConsensusAccount(net, accounts.consensus);
    if (account.available <= 0n) return 0n;
    const beneficiary = runtimeStakingAddress(target.runtimeId);
    const [nonce, allowance, publicKey] = await Promise.all([
      consensusNonce(net, accounts.consensus, account.nonce),
      consensusAllowance(net, accounts.consensus, beneficiary),
      getConsensusPublicKey(mnemonic),
    ]);
    let reserve = 0n;
    if (allowance < account.available) {
      const { fee } = await consensusFee(
        net,
        publicKey,
        buildStakingAllow({ beneficiary, amountChange: account.available, nonce, gas: 0n }),
      );
      reserve = fee;
    }
    return account.available > reserve ? account.available - reserve : 0n;
  }
  const [balance, gasPrice] = await Promise.all([fetchBalance(net, accounts), runtimeGasPrice(net)]);
  const reserve = MOVE_GAS_FALLBACK * gasPrice;
  if (balance <= reserve) return 0n;
  return (balance - reserve) / SCALING_FACTOR;
}

// Signs and submits a prepared move. `onStep(step)` is called with
// 'allow' | 'allowed' | 'submit' | 'submitted'.
export async function submitMove(net, p, mnemonic, onStep = () => {}) {
  const target = NETWORKS[p.target];
  if (p.direction === 'deposit') {
    let allowHash = null;
    if (p.allow) {
      // Re-check: an earlier attempt may already have granted the allowance.
      const current = await consensusAllowance(net, p.from, p.allow.beneficiary);
      if (current < p.amount) {
        onStep('allow');
        const nonce = await consensusNonce(net, p.from, p.allow.nonce);
        const signed = await signStakingAllow({
          mnemonic,
          beneficiary: p.allow.beneficiary,
          amountChange: p.amount - current,
          nonce,
          gas: p.allow.gas,
          feeAmount: p.allow.fee,
          chainContext: net.chainContext,
        });
        // Consensus SubmitTx returns once the transaction is in a block.
        await grpcUnary(net, 'Consensus', 'SubmitTx', signed.signed, SUBMIT_TIMEOUT);
        allowHash = signed.txHash;
      }
      onStep('allowed', allowHash);
    }
    onStep('submit');
    const nonce = await runtimeNonce(target, p.from);
    const signed = await signConsensusDeposit({
      mnemonic,
      to: p.toNative,
      amount: p.runtimeAmount,
      nonce,
      gas: p.runtimeGas,
      feeAmount: 0n,
      runtimeId: target.runtimeId,
      consensusChainContext: target.chainContext,
    });
    await submitRuntimeTx(target, signed.encoded);
    onStep('submitted', signed.txHash);
    return { hash: signed.txHash, allowHash, nonce, from: p.from, sapphire: target.key };
  }
  onStep('submit');
  const nonce = await runtimeNonce(net, p.fromNative);
  const signed = await signConsensusWithdraw({
    mnemonic,
    to: p.to,
    amount: p.runtimeAmount,
    nonce,
    gas: p.runtimeGas,
    feeAmount: p.runtimeFee,
    runtimeId: net.runtimeId,
    consensusChainContext: net.chainContext,
  });
  await submitRuntimeTx(net, signed.encoded);
  onStep('submitted', signed.txHash);
  return { hash: signed.txHash, allowHash: null, nonce, from: p.fromNative, sapphire: net.key };
}

// Polls Nexus for the consensus_accounts event that reports the outcome, matched
// by signer address and runtime nonce exactly as the Oasis CLI does. Resolves to
// {status: 'success' | 'failed' | 'timeout', error?}.
export async function waitForMove(sapphireNet, direction, { from, nonce }, options = {}) {
  const { timeout = 180000, interval = 5000, isCancelled = () => false } = options;
  const type =
    direction === 'deposit' ? 'consensus_accounts.deposit' : 'consensus_accounts.withdraw';
  const url = `${sapphireNet.nexus}/sapphire/events?rel=${encodeURIComponent(from)}&type=${type}&limit=20`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !isCancelled()) {
    try {
      const json = await nexusJson(url);
      const event = (json?.events || []).find(
        (e) =>
          String(e.body?.from || '').toLowerCase() === from.toLowerCase() &&
          BigInt(e.body?.nonce ?? -1) === BigInt(nonce),
      );
      if (event) {
        if (event.body.error)
          return {
            status: 'failed',
            error: `${event.body.error.module || 'consensus'} error ${event.body.error.code ?? ''}`.trim(),
          };
        return { status: 'success', round: event.round };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return { status: isCancelled() ? 'cancelled' : 'timeout' };
}
