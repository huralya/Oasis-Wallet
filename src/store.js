import { createVault, openVault, openVaultWithKey, sealVault, deriveAccounts } from './crypto.js';

const local = () => chrome.storage.local;
const session = () => chrome.storage.session;
const AUTOLOCK_ALARM = 'autolock';

export const AUTOLOCK_OPTIONS = [
  { value: 0, label: 'When the wallet closes' },
  { value: 5, label: 'After 5 minutes' },
  { value: 15, label: 'After 15 minutes' },
  { value: 30, label: 'After 30 minutes' },
  { value: 60, label: 'After 1 hour' },
];
export const DEFAULT_PREFS = { autoLock: 15, theme: 'system', hideBalance: false };

export async function loadPrefs() {
  const { prefs, selectedNetwork } = await local().get(['prefs', 'selectedNetwork']);
  const merged = { ...DEFAULT_PREFS, ...(prefs || {}) };
  if (!AUTOLOCK_OPTIONS.some((o) => o.value === merged.autoLock))
    merged.autoLock = DEFAULT_PREFS.autoLock;
  if (!['system', 'light', 'dark'].includes(merged.theme)) merged.theme = 'system';
  return { prefs: merged, selectedNetwork };
}
export const savePrefs = (prefs) => local().set({ prefs });
export const saveNetwork = (key) => local().set({ selectedNetwork: key });

export async function hasVault() {
  const { vault } = await local().get('vault');
  return !!vault;
}

function serialize(wallet) {
  return JSON.stringify({
    version: 2,
    activeWalletId: wallet.activeWalletId,
    wallets: wallet.wallets.map(({ id, name, mnemonic }) => ({ id, name, mnemonic })),
  });
}

async function hydrate(plaintext, cachedAccounts = {}) {
  let data = null;
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed?.version >= 2 && Array.isArray(parsed.wallets)) data = parsed;
  } catch {}
  // v0.1 vaults stored a single bare mnemonic.
  if (!data)
    data = {
      activeWalletId: 'wallet-1',
      wallets: [{ id: 'wallet-1', name: 'Wallet 1', mnemonic: plaintext.trim() }],
    };
  const wallets = [];
  for (const [i, w] of data.wallets.entries()) {
    const id = w.id || crypto.randomUUID();
    const accounts = cachedAccounts[id] || (await deriveAccounts(w.mnemonic));
    wallets.push({ id, name: w.name || `Wallet ${i + 1}`, mnemonic: w.mnemonic, accounts });
  }
  if (!wallets.length) throw new Error('Vault contains no wallets.');
  const activeWalletId = wallets.some((w) => w.id === data.activeWalletId)
    ? data.activeWalletId
    : wallets[0].id;
  return { wallets, activeWalletId, legacy: data.version !== 2 };
}

/**
 * In-memory unlocked wallet. `key` is the vault encryption key; it never
 * touches persistent storage and lives in session storage only while the
 * auto-lock timer allows it.
 */
export class Keyring {
  constructor({ wallets, activeWalletId }, key, meta) {
    this.wallets = wallets;
    this.activeWalletId = activeWalletId;
    this.key = key;
    this.meta = meta;
  }
  get active() {
    return this.wallets.find((w) => w.id === this.activeWalletId) || this.wallets[0];
  }
  hasMnemonic(mnemonic) {
    return this.wallets.some((w) => w.mnemonic === mnemonic);
  }
  async save() {
    const vault = await sealVault(serialize(this), this.key, this.meta.salt, this.meta.iterations);
    await local().set({ vault });
    await this.cacheAccounts();
  }
  async cacheAccounts() {
    const { unlocked } = await session().get('unlocked');
    if (!unlocked) return;
    unlocked.accounts = Object.fromEntries(this.wallets.map((w) => [w.id, w.accounts]));
    await session().set({ unlocked });
  }
}

export async function createKeyring(wallet, password) {
  const keyringData = { wallets: [wallet], activeWalletId: wallet.id };
  const { vault, keyHex } = await createVault(serialize(keyringData), password);
  await local().set({ vault });
  return new Keyring(keyringData, keyHex, { salt: vault.salt, iterations: vault.iterations });
}

export async function unlockKeyring(password) {
  const { vault } = await local().get('vault');
  if (!vault) throw new Error('No wallet found.');
  const { plaintext, keyHex } = await openVault(vault, password);
  const data = await hydrate(plaintext);
  const keyring = new Keyring(data, keyHex, { salt: vault.salt, iterations: vault.iterations });
  if (data.legacy) await keyring.save();
  return keyring;
}

export async function verifyPassword(password) {
  const { vault } = await local().get('vault');
  await openVault(vault, password);
}

export async function changePassword(keyring, current, next) {
  await verifyPassword(current);
  const { vault, keyHex } = await createVault(serialize(keyring), next);
  await local().set({ vault });
  keyring.key = keyHex;
  keyring.meta = { salt: vault.salt, iterations: vault.iterations };
}

// --- Session (auto-lock) ---

export async function startSession(keyring, minutes) {
  if (!minutes) return endSession();
  const expiresAt = Date.now() + minutes * 60000;
  await session().set({
    unlocked: {
      key: keyring.key,
      expiresAt,
      accounts: Object.fromEntries(keyring.wallets.map((w) => [w.id, w.accounts])),
    },
  });
  await chrome.alarms.create(AUTOLOCK_ALARM, { when: expiresAt });
}

export async function touchSession(minutes) {
  if (!minutes) return;
  const { unlocked } = await session().get('unlocked');
  if (!unlocked) return;
  unlocked.expiresAt = Date.now() + minutes * 60000;
  await session().set({ unlocked });
  await chrome.alarms.create(AUTOLOCK_ALARM, { when: unlocked.expiresAt });
}

export async function resumeSession() {
  const [{ unlocked }, { vault }] = await Promise.all([
    session().get('unlocked'),
    local().get('vault'),
  ]);
  if (!unlocked || !vault) return null;
  if (!(unlocked.expiresAt > Date.now())) {
    await endSession();
    return null;
  }
  try {
    const plaintext = await openVaultWithKey(vault, unlocked.key);
    const data = await hydrate(plaintext, unlocked.accounts || {});
    return new Keyring(data, unlocked.key, { salt: vault.salt, iterations: vault.iterations });
  } catch {
    await endSession();
    return null;
  }
}

export async function endSession() {
  await session().remove('unlocked');
  await chrome.alarms.clear(AUTOLOCK_ALARM);
}

export async function resetWallet() {
  await endSession();
  await local().remove(['vault']);
}
