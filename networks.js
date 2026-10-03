const MAINNET_CHAIN_CONTEXT = 'bb3d748def55bdfb797a2ac53ee6ee141e54cd2ab2dc2375f4a0703a178e6e55';
const TESTNET_CHAIN_CONTEXT = '0b91b8e4e44b2003a7c5e23ddadb5e14ef5345c0ebcb3ddcae07fa2f244cab76';

export const NETWORKS = {
  'sapphire-mainnet': {
    key: 'sapphire-mainnet',
    layer: 'Sapphire',
    env: 'Mainnet',
    kind: 'sapphire',
    symbol: 'ROSE',
    decimals: 18,
    chainId: 23294,
    rpc: 'https://sapphire.oasis.io',
    nexus: 'https://nexus.oasis.io/v1',
    grpc: 'https://grpc.oasis.io',
    chainContext: MAINNET_CHAIN_CONTEXT,
    runtimeId: '000000000000000000000000000000000000000000000000f80306c9858e7279',
  },
  'consensus-mainnet': {
    key: 'consensus-mainnet',
    layer: 'Consensus',
    env: 'Mainnet',
    kind: 'consensus',
    symbol: 'ROSE',
    decimals: 9,
    nexus: 'https://nexus.oasis.io/v1',
    grpc: 'https://grpc.oasis.io',
    chainContext: MAINNET_CHAIN_CONTEXT,
  },
  'sapphire-testnet': {
    key: 'sapphire-testnet',
    layer: 'Sapphire',
    env: 'Testnet',
    kind: 'sapphire',
    symbol: 'TEST',
    decimals: 18,
    chainId: 23295,
    rpc: 'https://testnet.sapphire.oasis.io',
    nexus: 'https://testnet.nexus.oasis.io/v1',
    grpc: 'https://testnet.grpc.oasis.io',
    chainContext: TESTNET_CHAIN_CONTEXT,
    runtimeId: '000000000000000000000000000000000000000000000000a6d1e3ebf60dff6c',
  },
  'consensus-testnet': {
    key: 'consensus-testnet',
    layer: 'Consensus',
    env: 'Testnet',
    kind: 'consensus',
    symbol: 'TEST',
    decimals: 9,
    nexus: 'https://testnet.nexus.oasis.io/v1',
    grpc: 'https://testnet.grpc.oasis.io',
    chainContext: TESTNET_CHAIN_CONTEXT,
  },
};

export const DEFAULT_NETWORK = 'sapphire-testnet';
export const isMainnet = (net) => net.env === 'Mainnet';

export function explorerTxUrl(net, hash) {
  const env = net.env.toLowerCase(),
    layer = net.kind === 'sapphire' ? 'sapphire' : 'consensus',
    clean = net.kind === 'sapphire' ? String(hash) : String(hash).replace(/^0x/, '');
  return `https://explorer.oasis.io/${env}/${layer}/tx/${encodeURIComponent(clean)}`;
}

export function explorerAddressUrl(net, address) {
  const env = net.env.toLowerCase(),
    layer = net.kind === 'sapphire' ? 'sapphire' : 'consensus';
  return `https://explorer.oasis.io/${env}/${layer}/address/${encodeURIComponent(address)}`;
}
