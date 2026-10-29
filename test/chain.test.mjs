// Offline tests for recipient routing and move validation rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NETWORKS, pairedNetwork } from '../src/networks.js';
import {
  SCALING_FACTOR,
  moveDirection,
  recipientRoute,
  validateMoveDestination,
  validateRecipient,
} from '../src/chain.js';
import { deriveAccounts, evmToRuntimeAddress } from '../src/crypto.js';

const sapphire = NETWORKS['sapphire-mainnet'];
const consensus = NETWORKS['consensus-mainnet'];
// Public development mnemonic (Hardhat / Foundry); never holds real funds.
const accounts = await deriveAccounts('test test test test test test test test test test test junk');
const OTHER_EVM = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const OTHER_CONSENSUS = 'oasis1qryqqccycvckcxp453tflalujvlf78xymcdqw4vz';

test('layers pair up per environment', () => {
  assert.equal(pairedNetwork(sapphire).key, 'consensus-mainnet');
  assert.equal(pairedNetwork(consensus).key, 'sapphire-mainnet');
  assert.equal(pairedNetwork(NETWORKS['sapphire-testnet']).key, 'consensus-testnet');
  assert.equal(moveDirection(consensus), 'deposit');
  assert.equal(moveDirection(sapphire), 'withdraw');
});

test('Sapphire sends accept 0x only; oasis1 is routed to Move', () => {
  assert.equal(recipientRoute(sapphire, OTHER_EVM), 'evm');
  assert.equal(validateRecipient(sapphire, accounts, OTHER_EVM), 'evm');
  assert.equal(recipientRoute(sapphire, OTHER_CONSENSUS), 'move');
  assert.throws(() => validateRecipient(sapphire, accounts, OTHER_CONSENSUS), /Move to Consensus/);
  assert.throws(() => validateRecipient(sapphire, accounts, accounts.sapphireNative), /Move to Consensus/);
  assert.throws(() => validateRecipient(sapphire, accounts, OTHER_EVM.toLowerCase().replace('5aa', '5Aa')), /checksum/);
  assert.throws(() => validateRecipient(sapphire, accounts, accounts.eth), /same wallet/);
  assert.throws(() => validateRecipient(sapphire, accounts, '0x' + '0'.repeat(40)), /zero address/);
});

test('Consensus sends accept oasis1 only; 0x is routed to Move', () => {
  assert.equal(validateRecipient(consensus, accounts, OTHER_CONSENSUS), 'consensus');
  assert.equal(recipientRoute(consensus, OTHER_EVM), 'move');
  assert.throws(() => validateRecipient(consensus, accounts, OTHER_EVM), /Move to Sapphire/);
  // The oasis1 form of the wallet's own 0x account is never a valid Consensus destination.
  assert.throws(() => validateRecipient(consensus, accounts, accounts.sapphireNative), /cannot be recovered/);
  assert.throws(() => validateRecipient(consensus, accounts, accounts.consensus), /same wallet/);
});

test('deposit destinations are checksummed 0x addresses', () => {
  assert.equal(validateMoveDestination(consensus, accounts, accounts.eth), accounts.eth);
  assert.equal(validateMoveDestination(consensus, accounts, OTHER_EVM), OTHER_EVM);
  assert.throws(() => validateMoveDestination(consensus, accounts, OTHER_CONSENSUS), /0x/);
  assert.throws(() => validateMoveDestination(consensus, accounts, evmToRuntimeAddress(OTHER_EVM)), /0x/);
  assert.throws(() => validateMoveDestination(consensus, accounts, '0x' + '0'.repeat(40)), /zero address/);
});

test('withdraw destinations are oasis1 and never the own Sapphire native address', () => {
  assert.equal(validateMoveDestination(sapphire, accounts, accounts.consensus), accounts.consensus);
  assert.equal(validateMoveDestination(sapphire, accounts, OTHER_CONSENSUS), OTHER_CONSENSUS);
  assert.throws(() => validateMoveDestination(sapphire, accounts, OTHER_EVM), /oasis1/);
  assert.throws(() => validateMoveDestination(sapphire, accounts, accounts.sapphireNative), /stuck/);
  assert.throws(() => validateMoveDestination(sapphire, accounts, OTHER_CONSENSUS.slice(0, -1) + 'q'), /not valid/);
});

test('decimal conversion between layers', () => {
  // Consensus has 9 decimals, Sapphire 18: 1 ROSE = 10^9 vs 10^18 base units.
  assert.equal(SCALING_FACTOR, 10n ** 9n);
  assert.equal(consensus.decimals + 9, sapphire.decimals);
  const oneRose = 10n ** 9n;
  assert.equal(oneRose * SCALING_FACTOR, 10n ** 18n);
});
