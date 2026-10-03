import {
  cborEncode,
  cborDecode,
  buildConsensusTransfer,
  decodeOasisAddress,
  fromHex,
  getConsensusPublicKey,
  isValidEvmAddress,
  isEvmAddress,
  signConsensusTransfer,
  signLegacyTransfer,
  signRuntimeTransfer,
} from './crypto.js';
import { explorerTxUrl } from './networks.js';

const REQUEST_TIMEOUT = 20000;
const SUBMIT_TIMEOUT = 60000;
const RUNTIME_TRANSFER_GAS = 70000n;
const SAPPHIRE_MIN_GAS_PRICE = 100000000000n; // 100 gwei
const EVM_TRANSFER_RESERVE_GAS = 30000n;
const ROUND_LATEST = 0xffffffffffffffffn;
const HEIGHT_LATEST = 0;

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

async function runtimeNonce(net, address) {
  const response = await grpcUnary(net, 'RuntimeClient', 'Query', {
    runtime_id: fromHex(net.runtimeId),
    round: ROUND_LATEST,
    method: 'accounts.Nonce',
    args: cborEncode({ address: decodeOasisAddress(address) }),
  });
  if (!response?.data) return 0n;
  return BigInt(cborDecode(response.data) ?? 0);
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

export async function fetchBalance(net, accounts) {
  if (net.kind === 'sapphire')
    return BigInt(await rpcCall(net, 'eth_getBalance', [accounts.eth, 'latest']));
  return (await consensusAccount(net, accounts.consensus)).available;
}

const TX_LABELS = {
  'staking.Transfer': null,
  'accounts.Transfer': null,
  'staking.AddEscrow': 'Delegated',
  'staking.ReclaimEscrow': 'Undelegated',
  'staking.Allow': 'Allowance',
  'staking.Withdraw': 'Withdrawal',
  'staking.Burn': 'Burn',
  'consensus.Deposit': 'Deposit',
  'consensus.Withdraw': 'Withdrawal',
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
  const sender = consensus ? tx.sender : tx.sender_0 || tx.sender_0_eth;
  const senderEth = consensus ? null : tx.sender_0_eth;
  const to = consensus ? tx.body?.to || tx.body?.account : tx.to || tx.to_eth;
  const toEth = consensus ? null : tx.to_eth;
  const outgoing = isOurs(sender) || isOurs(senderEth);
  const incoming = isOurs(to) || isOurs(toEth);

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

export function recipientRoute(net, to) {
  const value = String(to || '').trim();
  if (!value) return null;
  if (/^oasis1/i.test(value)) return net.kind === 'sapphire' ? 'runtime' : 'consensus';
  if (/^0x/i.test(value)) return net.kind === 'sapphire' ? 'evm' : 'invalid';
  return 'invalid';
}

export function validateRecipient(net, accounts, to) {
  const route = recipientRoute(net, to);
  if (!route) throw new Error('Enter a recipient address.');
  if (route === 'invalid')
    throw new Error(
      net.kind === 'sapphire'
        ? 'Enter a valid oasis1… or 0x… address.'
        : 'Consensus transfers require an oasis1… address.',
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
    const own = route === 'runtime' ? accounts.sapphireNative : accounts.consensus;
    if (to.toLowerCase() === own.toLowerCase())
      throw new Error('You cannot send to this same wallet.');
  }
  return route;
}

export async function estimateMaxSendable(net, balance) {
  if (!balance || balance <= 0n) return 0n;
  let reserve = 0n;
  if (net.kind === 'sapphire') {
    const price = await sapphireGasPrice(net);
    reserve =
      price *
      (RUNTIME_TRANSFER_GAS > EVM_TRANSFER_RESERVE_GAS
        ? RUNTIME_TRANSFER_GAS
        : EVM_TRANSFER_RESERVE_GAS);
  }
  return balance > reserve ? balance - reserve : 0n;
}

export async function prepareTransfer({ net, accounts, mnemonic, to, amount }) {
  to = String(to).trim();
  const route = validateRecipient(net, accounts, to);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  const base = { network: net.key, mode: route, to, amount };

  if (route === 'runtime') {
    const [nonce, gasPrice, balance] = await Promise.all([
      runtimeNonce(net, accounts.sapphireNative),
      sapphireGasPrice(net),
      fetchBalance(net, accounts),
    ]);
    const fee = RUNTIME_TRANSFER_GAS * gasPrice;
    if (amount + fee > balance)
      throw new Error(`Insufficient ${net.symbol} to cover the amount and network fee.`);
    return {
      ...base,
      from: accounts.sapphireNative,
      fee,
      nonce,
      gas: RUNTIME_TRANSFER_GAS,
      balance,
    };
  }

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

  const account = await consensusAccount(net, accounts.consensus);
  let nonce = account.nonce;
  try {
    // The indexer can lag a block or two behind; prefer the node's view.
    const live = await grpcUnary(net, 'Consensus', 'GetSignerNonce', {
      account_address: decodeOasisAddress(accounts.consensus),
      height: HEIGHT_LATEST,
    });
    if (live != null && BigInt(live) > nonce) nonce = BigInt(live);
  } catch {}
  if (amount > account.available) throw new Error(`Insufficient ${net.symbol}.`);
  const publicKey = await getConsensusPublicKey(mnemonic),
    draft = buildConsensusTransfer({ to, amount, nonce, gas: 0n });
  const gas = quantity(
    await grpcUnary(net, 'Consensus', 'EstimateGas', { signer: publicKey, transaction: draft }),
  );
  if (gas <= 0n) throw new Error('Could not estimate the network fee. Try again.');
  const minGasPrice = quantity(await grpcUnary(net, 'Consensus', 'MinGasPrice', undefined)),
    fee = minGasPrice * gas;
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
  if (p.mode === 'runtime') {
    const signed = await signRuntimeTransfer({
      mnemonic,
      to: p.to,
      amount: p.amount,
      nonce: p.nonce,
      gas: p.gas,
      feeAmount: p.fee,
      runtimeId: net.runtimeId,
      consensusChainContext: net.chainContext,
    });
    const response = await grpcUnary(
      net,
      'RuntimeClient',
      'SubmitTx',
      { runtime_id: fromHex(net.runtimeId), data: signed.encoded },
      SUBMIT_TIMEOUT,
    );
    if (response instanceof Uint8Array && response.length) {
      const result = cborDecode(response);
      if (result?.fail)
        throw new Error(result.fail.message || 'The Sapphire transaction was rejected.');
    }
    return signed.txHash;
  }
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
