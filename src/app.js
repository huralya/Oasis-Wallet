import {
  createMnemonic,
  validateMnemonic,
  normalizeMnemonic,
  deriveAccounts,
  loadWordlist,
  parseUnits,
  formatUnits,
  exportWalletSecrets,
} from './crypto.js';
import { qrSvg } from './qr.js';
import { icon } from './icons.js';
import {
  NETWORKS,
  DEFAULT_NETWORK,
  isMainnet,
  explorerTxUrl,
  explorerAddressUrl,
} from './networks.js';
import {
  fetchBalance,
  fetchActivity,
  prepareTransfer,
  submitTransfer,
  recipientRoute,
  validateRecipient,
  estimateMaxSendable,
} from './chain.js';
import * as store from './store.js';

const VERSION = chrome.runtime.getManifest().version;
const REPO_URL = 'https://github.com/huralya/Oasis-Wallet';
const TERMS_URL = `${REPO_URL}/blob/main/TERMS.md`;
const HURALYA_URL = 'https://huralya.com';
const MIN_PASSWORD = 8;
const REFRESH_INTERVAL = 20000;
const SENSITIVE_CLIPBOARD_TTL = 30000;

const app = document.getElementById('app');

const state = {
  screen: 'loading',
  history: [],
  keyring: null,
  prefs: { ...store.DEFAULT_PREFS },
  network: DEFAULT_NETWORK,
  balance: { value: null, loading: false, error: false },
  activity: { items: [], loading: false, error: null, loaded: false },
  sheet: null,
  modal: null,
  flow: null,
  draft: { to: '', amount: '' },
  pending: null,
  result: null,
  secret: null,
  receiveFormat: 'native',
  editWalletId: null,
  busy: false,
};

let lastRendered = null;
let loadToken = 0;
let refreshTimer = null;

// --- Helpers ---

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m],
  );
const short = (a, left = 8, right = 6) =>
  a && a.length > left + right + 1 ? `${a.slice(0, left)}…${a.slice(-right)}` : a || '';
const net = () => NETWORKS[state.network];
const wallet = () => state.keyring?.active;
const accounts = () => wallet()?.accounts;
const primaryAddress = (w = wallet(), n = net()) =>
  n.kind === 'sapphire' ? w?.accounts.sapphireNative : w?.accounts.consensus;

function groupDigits(whole) {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function amountParts(value, decimals, maxFraction = 4) {
  const text = formatUnits(value, decimals, maxFraction);
  const [whole, frac = ''] = text.split('.');
  if (value > 0n && whole === '0' && !frac)
    return { whole: '<0', frac: '.' + '0'.repeat(maxFraction - 1) + '1' };
  return { whole: groupDigits(whole), frac: frac ? '.' + frac : '' };
}
function fmt(value, decimals, maxFraction = 4) {
  const p = amountParts(value, decimals, maxFraction);
  return p.whole + p.frac;
}

// Wallets get a stable colour derived from their address.
function tone(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}
function avatar(w, size = '') {
  const initial = esc((w.name.trim()[0] || 'W').toUpperCase());
  return `<span class="avatar t${tone(w.accounts.consensus)} ${size}" aria-hidden="true">${initial}</span>`;
}

// Emphasises the start and end of an address so it can be checked at a glance.
function addressHtml(address) {
  const a = esc(address);
  if (a.length < 20) return `<span class="addr">${a}</span>`;
  return `<span class="addr"><b>${a.slice(0, 8)}</b>${a.slice(8, -8)}<b>${a.slice(-8)}</b></span>`;
}

function relativeTime(date) {
  if (!date) return '';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: diff > 31536000 ? 'numeric' : undefined,
  });
}

function friendlyError(error, fallback) {
  const message = error?.message || '';
  if (!message || /^(Failed to fetch|NetworkError|Load failed)/i.test(message)) return fallback;
  return message;
}

// --- Components ---

const btn = ({
  label,
  action,
  kind = 'primary',
  iconName,
  attrs = '',
  type = 'button',
  cls = '',
}) =>
  `<button type="${type}" class="btn ${kind} ${cls}" ${action ? `data-action="${action}"` : ''} ${attrs}>${iconName ? icon(iconName) : ''}<span>${label}</span></button>`;

const iconBtn = (name, action, label, attrs = '') =>
  `<button type="button" class="icon-btn" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;

function screen({
  title = '',
  back = true,
  right = '',
  body,
  dock = '',
  form = '',
  cls = '',
  progress = null,
}) {
  const tag = form ? 'form' : 'div';
  const bar = `<header class="bar">
      ${back ? iconBtn('arrowLeft', 'back', 'Back') : '<span class="bar-gap"></span>'}
      <h1 class="bar-title">${esc(title)}</h1>
      ${right || '<span class="bar-gap"></span>'}
    </header>
    ${progress ? `<div class="steps" aria-label="Step ${progress[0]} of ${progress[1]}">${Array.from({ length: progress[1] }, (_, i) => `<span class="${i < progress[0] ? 'on' : ''}"></span>`).join('')}</div>` : ''}`;
  return `<${tag} class="screen ${cls}" ${form ? `data-form="${form}" novalidate autocomplete="off"` : ''}>
    ${bar}
    <div class="scroll"><div class="content">${body}</div></div>
    ${dock ? `<div class="dock">${dock}</div>` : ''}
  </${tag}>`;
}

function field({
  id,
  label,
  type = 'text',
  placeholder = '',
  value = '',
  attrs = '',
  hint = '',
  suffix = '',
  mono = false,
}) {
  const isPassword = type === 'password';
  return `<div class="field">
    ${label ? `<label class="label" for="${id}">${label}</label>` : ''}
    <div class="control ${suffix || isPassword ? 'has-suffix' : ''}">
      <input id="${id}" name="${id}" class="input ${mono ? 'mono' : ''}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" spellcheck="false" autocapitalize="off" ${attrs}>
      ${isPassword ? `<button type="button" class="reveal" data-action="toggle-visibility" data-target="${id}" aria-label="Show password">${icon('eye')}</button>` : suffix}
    </div>
    ${hint ? `<div class="hint" id="${id}-hint">${hint}</div>` : ''}
  </div>`;
}

const formError = () => `<div class="form-error" role="alert" aria-live="polite"></div>`;

function callout(kind, iconName, html) {
  return `<div class="callout ${kind}">${icon(iconName)}<div>${html}</div></div>`;
}

function check(id, html, attrs = '') {
  return `<label class="check"><input type="checkbox" id="${id}" ${attrs}><span class="box">${icon('check')}</span><span class="check-text">${html}</span></label>`;
}

function networkPill() {
  const n = net();
  return `<button type="button" class="net-pill ${n.kind} ${isMainnet(n) ? 'main' : 'test'}" data-action="open-sheet" data-sheet="network" aria-label="Network: ${n.layer} ${n.env}">
    <span class="net-dot"></span><span class="net-text">${n.layer}<small>${n.env}</small></span>${icon('chevronDown')}
  </button>`;
}

function wordsGrid(words, { hidden = false } = {}) {
  return `<div class="words ${hidden ? 'concealed' : ''}">
    ${words.map((w, i) => `<div class="word"><span>${i + 1}</span><b>${esc(w)}</b></div>`).join('')}
    ${hidden ? `<button type="button" class="conceal-overlay" data-action="reveal-words">${icon('eye')}<b>Click to reveal</b><small>Make sure nobody is watching your screen</small></button>` : ''}
  </div>`;
}

// --- Screens: onboarding ---

function loadingView() {
  return `<div class="screen splash"><img src="../assets/oasis-mark.svg" alt="" class="splash-mark"></div>`;
}

function welcomeView() {
  return `<div class="screen welcome">
    <div class="welcome-hero">
      <div class="orb"><span></span><span></span><img src="../assets/oasis-mark.svg" alt=""></div>
      <h1>Oasis Wallet</h1>
      <p>A secure home for your ROSE on Sapphire and Consensus.</p>
    </div>
    <ul class="features">
      <li>${icon('shield')}<span><b>Self-custody</b><small>Your keys are encrypted and never leave this device.</small></span></li>
      <li>${icon('layers')}<span><b>Sapphire &amp; Consensus</b><small>Native oasis1 and EVM 0x addresses in one place.</small></span></li>
      <li>${icon('eyeOff')}<span><b>Private by design</b><small>No accounts, analytics or tracking.</small></span></li>
    </ul>
    <div class="welcome-actions">
      ${btn({ label: 'Create a new wallet', action: 'start-create', kind: 'primary', cls: 'block' })}
      ${btn({ label: 'I already have a wallet', action: 'start-import', kind: 'ghost', cls: 'block' })}
    </div>
    ${legalFooter()}
  </div>`;
}

function legalFooter() {
  return `<footer class="legal">
    <a href="${HURALYA_URL}" target="_blank" rel="noopener noreferrer">Huralya</a><span></span>
    <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Source</a><span></span>
    <a href="${TERMS_URL}" target="_blank" rel="noopener noreferrer">Terms</a>
  </footer>`;
}

function flowProgress(step) {
  const f = state.flow;
  if (!f?.initial) return null;
  return [step, f.kind === 'create' ? 3 : 2];
}

function createPhraseView() {
  const f = state.flow,
    words = f.mnemonic.split(' ');
  return screen({
    title: f.initial ? 'Create wallet' : 'New wallet',
    progress: flowProgress(1) || [1, 3],
    body: `
      <h2>Your recovery phrase</h2>
      <p class="lead">These ${words.length} words are the only way to restore this wallet. Write them down in order and keep them somewhere safe and offline.</p>
      ${wordsGrid(words, { hidden: !f.revealed })}
      ${callout('warn', 'alert', '<b>Never share this phrase.</b> Anyone who has it can take your funds. Huralya will never ask for it.')}
      ${check('savedCheck', 'I have written down my recovery phrase', 'data-change="phrase-saved"')}`,
    dock: btn({
      label: 'Continue',
      action: 'phrase-continue',
      cls: 'block',
      attrs: 'disabled id="phraseContinue"',
    }),
  });
}

function verifyPhraseView() {
  const f = state.flow;
  const rows = f.quiz
    .map(
      (q, i) => `<div class="quiz-row">
        <div class="quiz-label">Word <b>#${q.index + 1}</b></div>
        <div class="quiz-options">${q.options
          .map((o) => {
            const picked = q.picked === o,
              cls = picked ? (o === q.answer ? 'correct' : 'wrong') : '';
            return `<button type="button" class="chip ${cls}" data-action="quiz-pick" data-slot="${i}" data-word="${esc(o)}">${esc(o)}</button>`;
          })
          .join('')}</div>
      </div>`,
    )
    .join('');
  const done = f.quiz.every((q) => q.picked === q.answer);
  return screen({
    title: f.initial ? 'Create wallet' : 'New wallet',
    progress: flowProgress(2) || [2, 3],
    body: `
      <h2>Confirm your phrase</h2>
      <p class="lead">Select the correct word for each position to confirm your backup.</p>
      <div class="quiz">${rows}</div>`,
    dock: btn({
      label: 'Continue',
      action: 'quiz-continue',
      cls: 'block',
      attrs: done ? '' : 'disabled',
    }),
  });
}

function importPhraseView() {
  const f = state.flow;
  const nameField = f.initial
    ? ''
    : field({ id: 'walletName', label: 'Wallet name', value: f.name, attrs: 'maxlength="32"' });
  return screen({
    title: f.initial ? 'Import wallet' : 'Import wallet',
    form: 'import',
    progress: flowProgress(1),
    body: `
      <h2>Enter your recovery phrase</h2>
      <p class="lead">Type or paste your 12, 15, 18, 21 or 24 word phrase, with each word separated by a space.</p>
      <div class="field">
        <div class="control"><textarea id="phrase" class="input phrase" rows="4" spellcheck="false" autocapitalize="off" autocomplete="off" data-input="phrase" placeholder="word1 word2 word3 …">${esc(f.draft || '')}</textarea></div>
        <div class="hint row"><span id="wordCount">0 words</span><span id="phraseStatus"></span></div>
      </div>
      ${nameField}
      ${formError()}
      ${callout('info', 'shield', 'Your phrase is encrypted on this device and never sent anywhere.')}`,
    dock: btn({ label: f.initial ? 'Continue' : 'Import wallet', type: 'submit', cls: 'block' }),
  });
}

function setPasswordView() {
  const f = state.flow;
  return screen({
    title: f.kind === 'create' ? 'Create wallet' : 'Import wallet',
    form: 'set-password',
    progress: flowProgress(f.kind === 'create' ? 3 : 2),
    body: `
      <h2>Set a password</h2>
      <p class="lead">It unlocks Oasis Wallet on this device. If you forget it, you can restore your wallet with the recovery phrase.</p>
      ${field({ id: 'pw', label: 'Password', type: 'password', placeholder: `At least ${MIN_PASSWORD} characters`, attrs: 'autocomplete="new-password" data-input="strength" autofocus' })}
      <div class="strength" id="strength" data-level="0"><span></span><span></span><span></span><span></span><em></em></div>
      ${field({ id: 'pw2', label: 'Confirm password', type: 'password', placeholder: 'Repeat your password', attrs: 'autocomplete="new-password"' })}
      ${check('termsCheck', `I agree to the <a href="${TERMS_URL}" target="_blank" rel="noopener noreferrer">Terms of Use</a>`)}
      ${formError()}`,
    dock: btn({
      label: f.kind === 'create' ? 'Create wallet' : 'Import wallet',
      type: 'submit',
      cls: 'block',
    }),
  });
}

function nameWalletView() {
  return screen({
    title: 'New wallet',
    form: 'name-wallet',
    progress: [3, 3],
    body: `
      <h2>Name your wallet</h2>
      <p class="lead">Only you can see this name. You can change it later in settings.</p>
      ${field({ id: 'walletName', label: 'Wallet name', value: state.flow.name, attrs: 'maxlength="32" autofocus' })}
      ${formError()}`,
    dock: btn({ label: 'Add wallet', type: 'submit', cls: 'block' }),
  });
}

function unlockView() {
  return `<form class="screen unlock" data-form="unlock" novalidate>
    <div class="unlock-hero">
      <div class="orb small"><span></span><img src="../assets/oasis-mark.svg" alt=""></div>
      <h1>Welcome back</h1>
      <p>Enter your password to unlock your wallet.</p>
    </div>
    <div class="unlock-form">
      ${field({ id: 'pw', type: 'password', placeholder: 'Password', attrs: 'autocomplete="current-password" autofocus aria-label="Password"' })}
      ${formError()}
      ${btn({ label: 'Unlock', type: 'submit', cls: 'block' })}
      <button type="button" class="link-btn" data-action="open-modal" data-modal="reset">Forgot password?</button>
    </div>
    ${legalFooter()}
  </form>`;
}

// --- Screens: wallet ---

function balanceHtml() {
  const n = net(),
    b = state.balance;
  if (b.value == null && b.loading) return `<span class="sk sk-balance"></span>`;
  if (b.value == null && b.error)
    return `<span class="bc-error">Balance unavailable <button type="button" data-action="refresh">Retry</button></span>`;
  if (b.value == null) return `<span class="sk sk-balance"></span>`;
  if (state.prefs.hideBalance)
    return `<span class="bc-int">••••••</span><span class="bc-sym">${n.symbol}</span>`;
  const p = amountParts(b.value, n.decimals, 4);
  return `<span class="bc-int">${p.whole}</span><span class="bc-frac">${p.frac}</span><span class="bc-sym">${n.symbol}</span>`;
}

function activityHtml() {
  const a = state.activity,
    n = net();
  if (!a.loaded && (a.loading || !a.error))
    return `<div class="tx-list">${'<div class="tx sk-row"><span class="sk sk-icon"></span><span class="sk-lines"><span class="sk"></span><span class="sk"></span></span></div>'.repeat(3)}</div>`;
  if (a.error && !a.items.length)
    return `<div class="empty">${icon('alert')}<b>Couldn’t load activity</b><small>${esc(a.error)}</small>${btn({ label: 'Try again', action: 'refresh', kind: 'soft small' })}</div>`;
  if (!a.items.length)
    return `<div class="empty">${icon('sparkle')}<b>No activity yet</b><small>Transactions on ${n.layer} ${n.env} will appear here.</small></div>`;
  return `<div class="tx-list">${a.items
    .map((tx) => {
      const sign = tx.direction === 'in' ? '+' : tx.direction === 'out' ? '−' : '';
      const amount =
        tx.amount != null
          ? state.prefs.hideBalance
            ? `•••• ${n.symbol}`
            : `${sign}${fmt(tx.amount, n.decimals, 4)} ${n.symbol}`
          : '';
      const sub = [
        tx.counterparty
          ? `${tx.direction === 'in' ? 'From' : 'To'} ${short(tx.counterparty, 7, 4)}`
          : '',
        relativeTime(tx.time),
      ]
        .filter(Boolean)
        .join(' · ');
      const glyph = tx.direction === 'in' ? 'receive' : tx.direction === 'out' ? 'send' : 'route';
      const tag = tx.url ? 'a' : 'div';
      const link = tx.url ? `href="${esc(tx.url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<${tag} class="tx" ${link}>
        <span class="tx-icon ${tx.failed ? 'failed' : tx.direction}">${icon(tx.failed ? 'alert' : glyph)}</span>
        <span class="tx-main"><b>${esc(tx.label)}</b><small>${esc(sub)}</small></span>
        <span class="tx-side">${tx.failed ? '<span class="badge danger">Failed</span>' : `<b class="${tx.direction}">${esc(amount)}</b>`}</span>
      </${tag}>`;
    })
    .join('')}</div>
    <a class="tx-more" href="${esc(explorerAddressUrl(n, primaryAddress()))}" target="_blank" rel="noopener noreferrer">View all on Oasis Explorer ${icon('external')}</a>`;
}

function homeView() {
  const n = net(),
    w = wallet(),
    address = primaryAddress();
  return `<div class="screen home">
    <header class="topbar">
      <button type="button" class="wallet-switch" data-action="open-sheet" data-sheet="wallets" aria-label="Switch wallet">
        ${avatar(w)}<span class="ws-text"><b>${esc(w.name)}</b><small>${esc(short(address, 6, 4))}</small></span>${icon('chevronDown')}
      </button>
      <div class="topbar-actions">${networkPill()}${iconBtn('settings', 'go', 'Settings', 'data-to="settings"')}</div>
    </header>
    <div class="scroll"><div class="content">
      <section class="balance-card ${n.kind}">
        <div class="bc-glow"></div><img class="bc-mark" src="../assets/oasis-mark.svg" alt="">
        <div class="bc-top">
          <span class="bc-label">${n.layer} balance</span>
          <span class="env-chip ${isMainnet(n) ? 'main' : 'test'}">${n.env}</span>
        </div>
        <div class="bc-amount ${state.balance.loading ? 'is-loading' : ''}" id="balance">${balanceHtml()}</div>
        <div class="bc-bottom">
          <button type="button" class="bc-address" data-action="copy" data-value="${esc(address)}" title="Copy address">${esc(short(address, 10, 6))}${icon('copy')}</button>
          <button type="button" class="bc-icon" data-action="toggle-hide" aria-label="${state.prefs.hideBalance ? 'Show balance' : 'Hide balance'}">${icon(state.prefs.hideBalance ? 'eyeOff' : 'eye')}</button>
        </div>
      </section>
      <nav class="actions">
        <button type="button" class="action" data-action="go" data-to="send"><span>${icon('send')}</span>Send</button>
        <button type="button" class="action" data-action="go" data-to="receive"><span>${icon('receive')}</span>Receive</button>
        <a class="action" href="${esc(explorerAddressUrl(n, address))}" target="_blank" rel="noopener noreferrer"><span>${icon('globe')}</span>Explorer</a>
      </nav>
      <section class="panel activity">
        <div class="panel-head"><h3>Activity</h3>${iconBtn('refresh', 'refresh', 'Refresh', state.activity.loading || state.balance.loading ? 'data-spinning' : '')}</div>
        <div id="activity">${activityHtml()}</div>
      </section>
    </div></div>
  </div>`;
}

function receiveView() {
  const n = net(),
    sapphire = n.kind === 'sapphire',
    evm = sapphire && state.receiveFormat === 'evm',
    address = evm ? accounts().eth : primaryAddress();
  let qr;
  try {
    qr = qrSvg(address, { scale: 6, margin: 2 });
  } catch {
    qr = '<div class="qr-fallback">QR unavailable</div>';
  }
  const tabs = sapphire
    ? `<div class="segmented" role="tablist">
        <button type="button" role="tab" aria-selected="${!evm}" class="${evm ? '' : 'on'}" data-action="receive-format" data-format="native">Oasis · oasis1</button>
        <button type="button" role="tab" aria-selected="${evm}" class="${evm ? 'on' : ''}" data-action="receive-format" data-format="evm">EVM · 0x</button>
      </div>`
    : '';
  const note = evm
    ? 'Use this 0x address with exchanges, bridges and EVM wallets that support Sapphire.'
    : sapphire
      ? 'Native Oasis address for this Sapphire account. Both formats receive into the same balance.'
      : 'Your Oasis Consensus address. Use it for base-layer transfers and staking.';
  return screen({
    title: 'Receive',
    right: networkPill(),
    body: `
      ${tabs}
      <div class="qr-card">
        <div class="qr">${qr}<span class="qr-badge"><img src="../assets/oasis-mark.svg" alt=""></span></div>
        <div class="qr-label">${n.layer} ${n.env} · ${evm ? 'EVM address' : 'Oasis address'}</div>
        <div class="qr-address">${addressHtml(address)}</div>
        ${btn({ label: 'Copy address', action: 'copy', kind: 'soft', iconName: 'copy', cls: 'block', attrs: `data-value="${esc(address)}"` })}
      </div>
      ${callout(isMainnet(n) ? 'info' : 'warn', isMainnet(n) ? 'info' : 'alert', isMainnet(n) ? esc(note) : `<b>Testnet address.</b> Only send ${n.symbol} test tokens on ${n.layer} Testnet.`)}`,
  });
}

function sendView() {
  const n = net(),
    b = state.balance.value;
  const routeHint = routeHintHtml(state.draft.to);
  return screen({
    title: 'Send',
    right: networkPill(),
    form: 'send',
    body: `
      <div class="from-card">
        ${avatar(wallet())}
        <span><b>${esc(wallet().name)}</b><small>${esc(short(primaryAddress(), 10, 6))}</small></span>
        <span class="from-bal"><small>Available</small><b>${b == null ? '—' : fmt(b, n.decimals, 6)} ${n.symbol}</b></span>
      </div>
      ${isMainnet(n) ? callout('danger', 'alert', `<b>${n.layer} Mainnet.</b> This transfer moves real ROSE and cannot be reversed.`) : ''}
      <div class="field">
        <label class="label" for="to">Recipient</label>
        <div class="control"><textarea id="to" name="to" class="input mono recipient" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off" data-input="recipient" placeholder="${n.kind === 'sapphire' ? 'oasis1… or 0x… address' : 'oasis1… address'}">${esc(state.draft.to)}</textarea></div>
        <div class="hint" id="routeHint">${routeHint}</div>
      </div>
      <div class="field">
        <label class="label" for="amount">Amount</label>
        <div class="control amount has-suffix">
          <input id="amount" name="amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(state.draft.amount)}" data-input="amount">
          <span class="suffix"><span class="sym">${n.symbol}</span><button type="button" class="max" data-action="max">MAX</button></span>
        </div>
      </div>
      ${formError()}`,
    dock: btn({ label: 'Review', type: 'submit', cls: 'block', iconName: null }),
  });
}

function routeHintHtml(to) {
  const n = net(),
    route = recipientRoute(n, to);
  if (!route)
    return n.kind === 'sapphire'
      ? 'Send to a native oasis1 address or an EVM 0x address.'
      : 'Send to an Oasis Consensus oasis1 address.';
  if (route === 'invalid')
    return `<span class="bad">${n.kind === 'sapphire' ? 'Use an oasis1… or 0x… address' : 'Consensus only supports oasis1… addresses'}</span>`;
  try {
    validateRecipient(n, accounts(), to);
    const label = {
      runtime: 'Native Oasis transfer',
      evm: 'EVM transfer',
      consensus: 'Consensus transfer',
    }[route];
    return `<span class="good">${icon('check')} ${label}</span>`;
  } catch (e) {
    return String(to).trim().length >= (route === 'evm' ? 42 : 46)
      ? `<span class="bad">${esc(e.message)}</span>`
      : 'Keep typing…';
  }
}

const ROUTE_LABELS = {
  runtime: 'Native Oasis transfer',
  evm: 'EVM transfer',
  consensus: 'Consensus transfer',
};

function reviewView() {
  const p = state.pending,
    n = NETWORKS[p.network],
    main = isMainnet(n);
  const parts = amountParts(p.amount, n.decimals, 8);
  return screen({
    title: 'Review',
    cls: 'review',
    form: 'confirm',
    body: `
      <div class="review-hero">
        <small>You are sending</small>
        <div class="review-amount">${parts.whole}<span>${parts.frac}</span> <em>${n.symbol}</em></div>
        <span class="net-badge ${n.kind} ${main ? 'main' : 'test'}"><span class="net-dot"></span>${n.layer} ${n.env}</span>
      </div>
      <div class="panel rows">
        <div class="row"><span>From</span><b class="with-avatar">${avatar(wallet(), 'xs')}${esc(wallet().name)}</b></div>
        <div class="row stack"><span>To</span>${addressHtml(p.to)}</div>
        <div class="row"><span>Type</span><b>${ROUTE_LABELS[p.mode]}</b></div>
        <div class="row"><span>Network fee</span><b>${p.fee === 0n ? 'Free' : `${fmt(p.fee, n.decimals, 8)} ${n.symbol}`}</b></div>
        <div class="row total"><span>Total</span><b>${fmt(p.amount + p.fee, n.decimals, 8)} ${n.symbol}</b></div>
      </div>
      ${main ? check('mainnetCheck', `I have verified the recipient. I understand this sends <b>real ROSE</b> and can’t be undone.`, 'data-change="mainnet-confirm"') : callout('info', 'info', 'Testnet transfer — no real funds are involved.')}
      ${formError()}`,
    dock: `<div class="dock-row">${btn({ label: 'Edit', action: 'back', kind: 'ghost' })}${btn({ label: 'Confirm & send', type: 'submit', attrs: main ? 'disabled id="confirmBtn"' : 'id="confirmBtn"' })}</div>`,
  });
}

function resultView() {
  const r = state.result,
    n = NETWORKS[r.network];
  return `<div class="screen result">
    <div class="scroll"><div class="content center">
      <div class="success-mark"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="m15 27 7.5 7.5L38 19"/></svg></div>
      <h2>Transaction sent</h2>
      <p class="lead">${fmt(r.amount, n.decimals, 8)} ${n.symbol} to ${esc(short(r.to, 10, 6))} on ${n.layer} ${n.env}. It may take a few seconds to appear in your activity.</p>
      <div class="panel rows">
        <div class="row"><span>Transaction</span><button type="button" class="copy-inline" data-action="copy" data-value="${esc(r.hash)}">${esc(short(r.hash, 10, 8))}${icon('copy')}</button></div>
      </div>
    </div></div>
    <div class="dock"><div class="dock-row">
      <a class="btn ghost" href="${esc(explorerTxUrl(n, r.hash))}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>Explorer</span></a>
      ${btn({ label: 'Done', action: 'done' })}
    </div></div>
  </div>`;
}

// --- Screens: settings ---

function settingsRow({
  iconName,
  title,
  sub = '',
  action = '',
  attrs = '',
  href = '',
  value = '',
  danger = false,
  tail,
}) {
  const tag = href ? 'a' : 'button';
  const linkAttrs = href
    ? `href="${href}" target="_blank" rel="noopener noreferrer"`
    : `type="button" data-action="${action}"`;
  const end =
    tail ??
    (href
      ? icon('external', 'muted')
      : `${value ? `<span class="value">${esc(value)}</span>` : ''}${icon('chevronRight', 'muted')}`);
  return `<${tag} class="srow ${danger ? 'danger' : ''}" ${linkAttrs} ${attrs}>
    <span class="srow-icon">${icon(iconName)}</span>
    <span class="srow-text"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    ${end}
  </${tag}>`;
}

function settingsView() {
  const w = wallet(),
    p = state.prefs;
  const autoLock =
    store.AUTOLOCK_OPTIONS.find((o) => o.value === p.autoLock)?.label.replace('After ', '') || '';
  const theme = { system: 'System', light: 'Light', dark: 'Dark' }[p.theme];
  return screen({
    title: 'Settings',
    right: iconBtn('lock', 'lock', 'Lock wallet'),
    body: `
      <button type="button" class="profile" data-action="go" data-to="wallets">
        ${avatar(w, 'lg')}
        <span><b>${esc(w.name)}</b><small>${state.keyring.wallets.length} wallet${state.keyring.wallets.length > 1 ? 's' : ''} on this device</small></span>
        <span class="profile-cta">Manage${icon('chevronRight')}</span>
      </button>
      <div class="group-title">Preferences</div>
      <div class="panel list">
        ${settingsRow({ iconName: 'layers', title: 'Network', action: 'open-sheet', attrs: 'data-sheet="network"', value: `${net().layer} ${net().env}` })}
        ${settingsRow({ iconName: 'contrast', title: 'Appearance', action: 'open-sheet', attrs: 'data-sheet="theme"', value: theme })}
        ${settingsRow({ iconName: 'eyeOff', title: 'Hide balances', action: 'toggle-hide', tail: `<span class="switch ${p.hideBalance ? 'on' : ''}" role="switch" aria-checked="${p.hideBalance}"></span>` })}
      </div>
      <div class="group-title">Security</div>
      <div class="panel list">
        ${settingsRow({ iconName: 'clock', title: 'Auto-lock', action: 'open-sheet', attrs: 'data-sheet="autolock"', value: autoLock })}
        ${settingsRow({ iconName: 'lock', title: 'Change password', action: 'go', attrs: 'data-to="change-password"' })}
        ${settingsRow({ iconName: 'shield', title: 'Recovery phrase', sub: `Back up ${esc(w.name)}`, action: 'reveal', attrs: 'data-type="phrase"' })}
        ${settingsRow({ iconName: 'key', title: 'Private keys', sub: 'Export Sapphire and Consensus keys', action: 'reveal', attrs: 'data-type="keys"' })}
      </div>
      <div class="group-title">About</div>
      <div class="panel list">
        ${settingsRow({ iconName: 'code', title: 'Source code', sub: 'huralya/Oasis-Wallet', href: REPO_URL })}
        ${settingsRow({ iconName: 'file', title: 'Terms of Use', href: TERMS_URL })}
        ${settingsRow({ iconName: 'globe', title: 'Huralya', sub: 'huralya.com', href: HURALYA_URL })}
      </div>
      <div class="settings-foot">
        ${btn({ label: 'Lock wallet', action: 'lock', kind: 'soft', iconName: 'lock', cls: 'block' })}
        <button type="button" class="link-btn danger" data-action="open-modal" data-modal="reset">Reset wallet on this device</button>
        <div class="version">Oasis Wallet ${esc(VERSION)}</div>
      </div>`,
  });
}

function walletsView() {
  const k = state.keyring;
  return screen({
    title: 'Wallets',
    body: `
      <p class="lead">Each wallet has its own recovery phrase and keys.</p>
      <div class="panel list">
        ${k.wallets
          .map(
            (
              w,
            ) => `<button type="button" class="srow" data-action="edit-wallet" data-id="${esc(w.id)}">
              ${avatar(w)}
              <span class="srow-text"><b>${esc(w.name)}${w.id === k.activeWalletId ? ' <span class="badge">Active</span>' : ''}</b><small class="mono">${esc(short(primaryAddress(w), 12, 8))}</small></span>
              ${icon('chevronRight', 'muted')}
            </button>`,
          )
          .join('')}
      </div>`,
    dock: btn({
      label: 'Add wallet',
      action: 'go',
      iconName: 'plus',
      cls: 'block',
      attrs: 'data-to="add-wallet"',
    }),
  });
}

function walletEditView() {
  const w = state.keyring.wallets.find((x) => x.id === state.editWalletId);
  if (!w) return walletsView();
  const only = state.keyring.wallets.length < 2;
  return screen({
    title: 'Edit wallet',
    form: 'rename-wallet',
    body: `
      <div class="center-block">${avatar(w, 'xl')}</div>
      ${field({ id: 'walletName', label: 'Name', value: w.name, attrs: 'maxlength="32"' })}
      <div class="panel rows">
        <div class="row stack"><span>Sapphire</span><span class="addr small">${esc(w.accounts.sapphireNative)}</span></div>
        <div class="row stack"><span>Sapphire EVM</span><span class="addr small">${esc(w.accounts.eth)}</span></div>
        <div class="row stack"><span>Consensus</span><span class="addr small">${esc(w.accounts.consensus)}</span></div>
      </div>
      ${formError()}
      <button type="button" class="link-btn danger" data-action="open-modal" data-modal="remove-wallet" ${only ? 'disabled title="You need at least one wallet"' : ''}>${icon('trash')} Remove this wallet</button>`,
    dock: btn({ label: 'Save', type: 'submit', cls: 'block' }),
  });
}

function addWalletView() {
  return screen({
    title: 'Add wallet',
    body: `
      <p class="lead">Add a separate wallet with its own recovery phrase. All wallets are protected by your current password.</p>
      <button type="button" class="choice" data-action="add-create"><span class="choice-icon">${icon('plus')}</span><span><b>Create a new wallet</b><small>Generate a fresh 12-word recovery phrase</small></span>${icon('chevronRight', 'muted')}</button>
      <button type="button" class="choice" data-action="add-import"><span class="choice-icon">${icon('download')}</span><span><b>Import a wallet</b><small>Restore with an existing recovery phrase</small></span>${icon('chevronRight', 'muted')}</button>`,
  });
}

function revealGateView() {
  const phrase = state.secret.type === 'phrase';
  return screen({
    title: phrase ? 'Recovery phrase' : 'Private keys',
    form: 'reveal',
    body: `
      <div class="gate-icon ${phrase ? '' : 'key'}">${icon(phrase ? 'shield' : 'key')}</div>
      <h2 class="center">${phrase ? 'Reveal recovery phrase' : 'Export private keys'}</h2>
      <p class="lead center">For <b>${esc(wallet().name)}</b></p>
      <ul class="warn-list">
        <li>${icon('alert')}<span>Anyone with ${phrase ? 'this phrase' : 'these keys'} has full control of your funds.</span></li>
        <li>${icon('eyeOff')}<span>Never paste ${phrase ? 'it' : 'them'} into a website, chat or support form.</span></li>
        <li>${icon('shield')}<span>Huralya will never ask for ${phrase ? 'your recovery phrase' : 'your private keys'}.</span></li>
      </ul>
      ${field({ id: 'pw', label: 'Password', type: 'password', placeholder: 'Enter your password', attrs: 'autocomplete="current-password" autofocus' })}
      ${formError()}`,
    dock: btn({ label: 'Reveal', type: 'submit', cls: 'block' }),
  });
}

function revealView() {
  const s = state.secret,
    w = wallet();
  if (s.type === 'phrase') {
    const words = w.mnemonic.split(' ');
    return screen({
      title: 'Recovery phrase',
      body: `
        ${callout('warn', 'alert', `<b>Keep this private.</b> This phrase restores ${esc(w.name)} on any device.`)}
        ${wordsGrid(words, { hidden: !s.revealed })}
        ${btn({ label: 'Copy to clipboard', action: 'copy', kind: 'soft', iconName: 'copy', cls: 'block', attrs: `data-value="${esc(w.mnemonic)}" data-sensitive` })}`,
      dock: btn({ label: 'Done', action: 'back', cls: 'block' }),
    });
  }
  const k = s.data;
  const card = (title, sub, value) => `<div class="secret">
      <div class="secret-head"><b>${title}</b><small>${sub}</small></div>
      <div class="secret-value ${s.revealed ? '' : 'blurred'}">${esc(value)}</div>
      <div class="secret-actions">${btn({ label: 'Copy', action: 'copy', kind: 'soft small', iconName: 'copy', attrs: `data-value="${esc(value)}" data-sensitive` })}</div>
    </div>`;
  return screen({
    title: 'Private keys',
    body: `
      ${callout('warn', 'alert', '<b>Private keys equal full access.</b> Import them only into wallets you trust.')}
      ${card('Sapphire', 'secp256k1 private key · EVM compatible', k.sapphirePrivateKey)}
      ${card('Consensus', 'Ed25519 private seed', k.consensusPrivateSeed)}
      ${s.revealed ? '' : btn({ label: 'Show keys', action: 'reveal-words', kind: 'ghost', iconName: 'eye', cls: 'block' })}`,
    dock: btn({ label: 'Done', action: 'back', cls: 'block' }),
  });
}

function changePasswordView() {
  return screen({
    title: 'Change password',
    form: 'change-password',
    body: `
      <p class="lead">Your wallets are re-encrypted with the new password. Your recovery phrases and addresses stay the same.</p>
      ${field({ id: 'current', label: 'Current password', type: 'password', attrs: 'autocomplete="current-password" autofocus' })}
      ${field({ id: 'pw', label: 'New password', type: 'password', placeholder: `At least ${MIN_PASSWORD} characters`, attrs: 'autocomplete="new-password" data-input="strength"' })}
      <div class="strength" id="strength" data-level="0"><span></span><span></span><span></span><span></span><em></em></div>
      ${field({ id: 'pw2', label: 'Confirm new password', type: 'password', attrs: 'autocomplete="new-password"' })}
      ${formError()}`,
    dock: btn({ label: 'Update password', type: 'submit', cls: 'block' }),
  });
}

// --- Overlays ---

function sheetView() {
  if (!state.sheet) return '';
  let title = '',
    body = '';
  if (state.sheet === 'network') {
    title = 'Network';
    const option = (key) => {
      const n = NETWORKS[key],
        on = state.network === key;
      return `<button type="button" class="option ${on ? 'on' : ''}" data-action="select-network" data-key="${key}">
        <span class="layer-icon ${n.kind}">${n.kind === 'sapphire' ? 'S' : 'C'}</span>
        <span class="option-text"><b>${n.layer}</b><small>${n.kind === 'sapphire' ? 'Confidential EVM ParaTime' : 'Base layer · staking & transfers'}</small></span>
        ${on ? `<span class="tick">${icon('check')}</span>` : ''}
      </button>`;
    };
    body = `<div class="option-group">Mainnet</div>${option('sapphire-mainnet')}${option('consensus-mainnet')}
      <div class="option-group">Testnet</div>${option('sapphire-testnet')}${option('consensus-testnet')}`;
  } else if (state.sheet === 'wallets') {
    title = 'Wallets';
    const k = state.keyring;
    body = `${k.wallets
      .map((w) => {
        const on = w.id === k.activeWalletId;
        return `<button type="button" class="option ${on ? 'on' : ''}" data-action="select-wallet" data-id="${esc(w.id)}">
          ${avatar(w)}<span class="option-text"><b>${esc(w.name)}</b><small class="mono">${esc(short(primaryAddress(w), 10, 6))}</small></span>
          ${on ? `<span class="tick">${icon('check')}</span>` : ''}
        </button>`;
      })
      .join('')}
      <div class="sheet-actions">${btn({ label: 'Manage', action: 'go', kind: 'ghost', attrs: 'data-to="wallets"' })}${btn({ label: 'Add wallet', action: 'go', kind: 'soft', iconName: 'plus', attrs: 'data-to="add-wallet"' })}</div>`;
  } else if (state.sheet === 'theme') {
    title = 'Appearance';
    body = [
      ['system', 'System', 'Match your device'],
      ['light', 'Light', ''],
      ['dark', 'Dark', ''],
    ]
      .map(
        ([
          v,
          l,
          s,
        ]) => `<button type="button" class="option ${state.prefs.theme === v ? 'on' : ''}" data-action="set-theme" data-value="${v}">
          <span class="option-text"><b>${l}</b>${s ? `<small>${s}</small>` : ''}</span>${state.prefs.theme === v ? `<span class="tick">${icon('check')}</span>` : ''}
        </button>`,
      )
      .join('');
  } else if (state.sheet === 'autolock') {
    title = 'Auto-lock';
    body = `<p class="sheet-note">Lock the wallet automatically after a period of inactivity.</p>${store.AUTOLOCK_OPTIONS.map(
      (
        o,
      ) => `<button type="button" class="option ${state.prefs.autoLock === o.value ? 'on' : ''}" data-action="set-autolock" data-value="${o.value}">
        <span class="option-text"><b>${o.label}</b></span>${state.prefs.autoLock === o.value ? `<span class="tick">${icon('check')}</span>` : ''}
      </button>`,
    ).join('')}`;
  }
  return `<div class="overlay" data-action="close-overlay">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h3>${esc(title)}</h3>${iconBtn('close', 'close-overlay', 'Close')}</div>
      <div class="sheet-body">${body}</div>
    </div>
  </div>`;
}

function modalView() {
  if (!state.modal) return '';
  let content = '';
  if (state.modal === 'reset') {
    content = `<form data-form="reset" novalidate>
      <div class="modal-icon danger">${icon('alert')}</div>
      <h3>Reset wallet?</h3>
      <p>This removes every wallet from this device. You can only restore them with their recovery phrases.</p>
      ${field({ id: 'confirmText', placeholder: 'Type RESET to confirm', attrs: 'data-input="reset-confirm" autocomplete="off" aria-label="Type RESET to confirm"' })}
      <div class="modal-actions">${btn({ label: 'Cancel', action: 'close-overlay', kind: 'ghost' })}${btn({ label: 'Reset', type: 'submit', kind: 'danger-solid', attrs: 'disabled id="resetConfirm"' })}</div>
    </form>`;
  } else if (state.modal === 'remove-wallet') {
    const w = state.keyring.wallets.find((x) => x.id === state.editWalletId);
    content = `<form data-form="remove-wallet" novalidate>
      <div class="modal-icon danger">${icon('trash')}</div>
      <h3>Remove ${esc(w?.name)}?</h3>
      <p>Make sure its recovery phrase is backed up. Without it, this wallet can’t be restored.</p>
      ${field({ id: 'pw', type: 'password', placeholder: 'Password', attrs: 'autocomplete="current-password" autofocus aria-label="Password"' })}
      ${formError()}
      <div class="modal-actions">${btn({ label: 'Cancel', action: 'close-overlay', kind: 'ghost' })}${btn({ label: 'Remove', type: 'submit', kind: 'danger-solid' })}</div>
    </form>`;
  }
  return `<div class="overlay center" data-action="close-overlay"><div class="modal" role="alertdialog" aria-modal="true">${content}</div></div>`;
}

// --- Rendering ---

const VIEWS = {
  loading: loadingView,
  welcome: welcomeView,
  'create-phrase': createPhraseView,
  'verify-phrase': verifyPhraseView,
  'import-phrase': importPhraseView,
  'set-password': setPasswordView,
  'name-wallet': nameWalletView,
  unlock: unlockView,
  home: homeView,
  receive: receiveView,
  send: sendView,
  review: reviewView,
  result: resultView,
  settings: settingsView,
  wallets: walletsView,
  'wallet-edit': walletEditView,
  'add-wallet': addWalletView,
  'reveal-gate': revealGateView,
  reveal: revealView,
  'change-password': changePasswordView,
};
const FLOW_SCREENS = new Set([
  'create-phrase',
  'verify-phrase',
  'import-phrase',
  'set-password',
  'name-wallet',
]);
const SECRET_SCREENS = new Set(['reveal-gate', 'reveal']);
const LOCKED_SCREENS = new Set(['loading', 'welcome', 'unlock', ...FLOW_SCREENS]);

function render() {
  if (!state.keyring && !LOCKED_SCREENS.has(state.screen)) state.screen = 'unlock';
  if (!FLOW_SCREENS.has(state.screen)) state.flow = null;
  if (!SECRET_SCREENS.has(state.screen)) state.secret = null;
  if (state.screen !== 'review') state.pending = null;
  if (state.screen !== 'result') state.result = null;

  const entering = lastRendered !== state.screen;
  const scrollTop = entering ? 0 : app.querySelector('.scroll')?.scrollTop || 0;
  app.innerHTML = (VIEWS[state.screen] || welcomeView)() + sheetView() + modalView();
  app.firstElementChild?.classList.toggle('enter', entering);
  const scroller = app.querySelector('.screen .scroll');
  if (scroller) scroller.scrollTop = scrollTop;
  lastRendered = state.screen;

  if (state.screen === 'import-phrase') updatePhraseStatus(document.getElementById('phrase'));
  const focus =
    app.querySelector('.modal [autofocus]') ||
    (entering && !state.sheet ? app.querySelector('.screen [autofocus]') : null);
  focus?.focus();
  scheduleRefresh();
}

// Update only the live parts of the home screen so open overlays keep their state.
function patchHome() {
  if (state.screen !== 'home') return;
  if (state.sheet || state.modal) return render();
  const balance = document.getElementById('balance'),
    activity = document.getElementById('activity'),
    refresh = app.querySelector('[data-action="refresh"].icon-btn');
  if (!balance || !activity) return render();
  balance.innerHTML = balanceHtml();
  balance.classList.toggle('is-loading', state.balance.loading);
  activity.innerHTML = activityHtml();
  refresh?.toggleAttribute('data-spinning', state.activity.loading || state.balance.loading);
}

function go(screenName, { replace = false } = {}) {
  if (!replace && state.screen !== screenName) state.history.push(state.screen);
  state.screen = screenName;
  state.sheet = null;
  state.modal = null;
  render();
  if (screenName === 'home') refresh();
}

function resetTo(screenName) {
  state.history = [];
  go(screenName, { replace: true });
}

function back() {
  let prev = state.history.pop();
  while (prev && (prev === state.screen || prev === 'loading')) prev = state.history.pop();
  go(prev || (state.keyring ? 'home' : 'welcome'), { replace: true });
}

function toast(message, kind = 'ok') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : 'alert')}<span>${esc(message)}</span>`;
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}

function showError(form, message) {
  const el = (form || app).querySelector('.form-error');
  if (!el) return toast(message, 'error');
  el.textContent = message;
  el.classList.add('show');
}
function clearError(form) {
  const el = (form || app).querySelector('.form-error');
  if (el) {
    el.textContent = '';
    el.classList.remove('show');
  }
}

async function withBusy(button, task) {
  if (state.busy) return;
  state.busy = true;
  button?.classList.add('loading');
  if (button) button.disabled = true;
  try {
    return await task();
  } finally {
    state.busy = false;
    if (button?.isConnected) {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }
}

// --- Data loading ---

function resetData() {
  loadToken++;
  state.balance = { value: null, loading: false, error: false };
  state.activity = { items: [], loading: false, error: null, loaded: false };
}

async function refresh() {
  if (!state.keyring) return;
  const token = loadToken,
    n = net(),
    acc = accounts();
  if (state.balance.loading || state.activity.loading) return;
  state.balance.loading = true;
  state.activity.loading = true;
  patchHome();
  await Promise.allSettled([
    fetchBalance(n, acc).then(
      (value) => {
        if (token !== loadToken) return;
        state.balance = { value, loading: false, error: false };
      },
      () => {
        if (token !== loadToken) return;
        state.balance = { ...state.balance, loading: false, error: true };
      },
    ),
    fetchActivity(n, acc).then(
      (items) => {
        if (token !== loadToken) return;
        state.activity = { items, loading: false, error: null, loaded: true };
      },
      (e) => {
        if (token !== loadToken) return;
        state.activity = {
          ...state.activity,
          loading: false,
          error: friendlyError(e, 'Network unavailable.'),
        };
      },
    ),
  ]);
  if (token === loadToken && state.screen === 'home') patchHome();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  if (state.screen === 'home' && state.keyring)
    refreshTimer = setInterval(
      () => document.visibilityState === 'visible' && refresh(),
      REFRESH_INTERVAL,
    );
}

// --- Session ---

async function openKeyring(keyring) {
  state.keyring = keyring;
  resetData();
  await store.startSession(keyring, state.prefs.autoLock);
  resetTo('home');
}

async function lock() {
  state.keyring = null;
  resetData();
  state.draft = { to: '', amount: '' };
  await store.endSession();
  resetTo('unlock');
}

let lastTouch = 0;
function touch() {
  if (!state.keyring || Date.now() - lastTouch < 30000) return;
  lastTouch = Date.now();
  store.touchSession(state.prefs.autoLock).catch(() => {});
}

function applyTheme() {
  document.documentElement.dataset.theme = state.prefs.theme;
}

async function savePrefs() {
  await store.savePrefs(state.prefs);
}

// --- Flows ---

const randomInt = (max) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function buildQuiz(words, wordlist) {
  const positions = new Set();
  while (positions.size < 3) positions.add(randomInt(words.length));
  return [...positions]
    .sort((a, b) => a - b)
    .map((index) => {
      const answer = words[index],
        options = new Set([answer]);
      while (options.size < 3) options.add(wordlist[randomInt(wordlist.length)]);
      return { index, answer, options: shuffle(options), picked: null };
    });
}

function defaultWalletName() {
  const names = new Set(state.keyring?.wallets.map((w) => w.name) || []);
  let i = (state.keyring?.wallets.length || 0) + 1;
  while (names.has(`Wallet ${i}`)) i++;
  return `Wallet ${i}`;
}

async function startCreate(initial) {
  try {
    const mnemonic = await createMnemonic();
    state.flow = { kind: 'create', initial, mnemonic, revealed: false, name: defaultWalletName() };
    go('create-phrase');
  } catch (e) {
    toast(friendlyError(e, 'Could not generate a recovery phrase.'), 'error');
  }
}

function startImport(initial) {
  state.flow = { kind: 'import', initial, mnemonic: null, draft: '', name: defaultWalletName() };
  go('import-phrase');
}

async function addWalletToKeyring(mnemonic, name) {
  const k = state.keyring;
  if (k.hasMnemonic(mnemonic)) throw new Error('This wallet has already been added.');
  const w = {
    id: crypto.randomUUID(),
    name: name.trim() || defaultWalletName(),
    mnemonic,
    accounts: await deriveAccounts(mnemonic),
  };
  k.wallets.push(w);
  k.activeWalletId = w.id;
  await k.save();
  resetData();
  resetTo('home');
  toast(`${w.name} added`);
}

let phraseCheck = 0;
async function updatePhraseStatus(input) {
  if (!input) return;
  if (state.flow) state.flow.draft = input.value;
  const words = normalizeMnemonic(input.value).split(' ').filter(Boolean);
  const count = document.getElementById('wordCount'),
    status = document.getElementById('phraseStatus');
  if (count) count.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;
  if (!status) return;
  const id = ++phraseCheck;
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    status.innerHTML = '';
    input.classList.remove('valid');
    return;
  }
  const ok = await validateMnemonic(words.join(' ')).catch(() => false);
  if (id !== phraseCheck) return;
  status.innerHTML = ok
    ? `<span class="good">${icon('check')} Valid phrase</span>`
    : `<span class="bad">Invalid phrase</span>`;
  input.classList.toggle('valid', ok);
}

function passwordStrength(pw) {
  if (!pw) return 0;
  if (pw.length < MIN_PASSWORD) return 1;
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 16) score++;
  return Math.min(4, score);
}

function checkNewPassword(form) {
  const pw = form.pw.value,
    pw2 = form.pw2.value;
  if (pw.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  if (pw !== pw2) throw new Error('Passwords do not match.');
  return pw;
}

// --- Clipboard ---

let clipboardTimer = null;
async function copy(value, sensitive) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return toast('Could not copy to clipboard', 'error');
  }
  clearTimeout(clipboardTimer);
  if (sensitive) {
    toast('Copied. Clipboard clears in 30s');
    clipboardTimer = setTimeout(
      () => navigator.clipboard.writeText('').catch(() => {}),
      SENSITIVE_CLIPBOARD_TTL,
    );
  } else toast('Copied to clipboard');
}

// --- Actions ---

const actions = {
  back,
  go: (el) => go(el.dataset.to),
  'start-create': () => startCreate(true),
  'start-import': () => startImport(true),
  'add-create': () => startCreate(false),
  'add-import': () => startImport(false),
  'reveal-words': () => {
    if (state.flow) state.flow.revealed = true;
    if (state.secret) state.secret.revealed = true;
    render();
  },
  'phrase-continue': async () => {
    const wordlist = await loadWordlist();
    state.flow.quiz = buildQuiz(state.flow.mnemonic.split(' '), wordlist);
    go('verify-phrase');
  },
  'quiz-pick': (el) => {
    const q = state.flow.quiz[Number(el.dataset.slot)];
    if (q.picked === q.answer) return;
    q.picked = el.dataset.word;
    render();
    if (q.picked !== q.answer)
      app
        .querySelector(`.chip.wrong`)
        ?.animate(
          [
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'none' },
          ],
          { duration: 220, iterations: 2 },
        );
  },
  'quiz-continue': () => {
    if (!state.flow.quiz.every((q) => q.picked === q.answer)) return;
    go(state.flow.initial ? 'set-password' : 'name-wallet');
  },
  'toggle-visibility': (el) => {
    const input = document.getElementById(el.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.innerHTML = icon(show ? 'eyeOff' : 'eye');
    el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  },
  'open-sheet': (el) => {
    state.sheet = el.dataset.sheet;
    render();
  },
  'open-modal': (el) => {
    state.sheet = null;
    state.modal = el.dataset.modal;
    render();
  },
  'close-overlay': () => {
    state.sheet = null;
    state.modal = null;
    render();
  },
  'select-network': async (el) => {
    const key = el.dataset.key;
    state.sheet = null;
    if (NETWORKS[key] && key !== state.network) {
      state.network = key;
      state.draft = { to: '', amount: '' };
      state.receiveFormat = 'native';
      resetData();
      await store.saveNetwork(key);
      if (['send', 'review'].includes(state.screen)) state.screen = 'send';
      toast(`Switched to ${NETWORKS[key].layer} ${NETWORKS[key].env}`);
    }
    render();
    refresh();
  },
  'select-wallet': async (el) => {
    const k = state.keyring;
    state.sheet = null;
    if (el.dataset.id !== k.activeWalletId && k.wallets.some((w) => w.id === el.dataset.id)) {
      k.activeWalletId = el.dataset.id;
      resetData();
      await k.save();
    }
    render();
    refresh();
  },
  'edit-wallet': (el) => {
    state.editWalletId = el.dataset.id;
    go('wallet-edit');
  },
  'set-theme': async (el) => {
    state.prefs.theme = el.dataset.value;
    state.sheet = null;
    applyTheme();
    await savePrefs();
    render();
  },
  'set-autolock': async (el) => {
    state.prefs.autoLock = Number(el.dataset.value);
    state.sheet = null;
    await savePrefs();
    if (state.keyring) await store.startSession(state.keyring, state.prefs.autoLock);
    render();
  },
  'toggle-hide': async () => {
    state.prefs.hideBalance = !state.prefs.hideBalance;
    await savePrefs();
    render();
  },
  refresh: () => refresh(),
  copy: (el) => copy(el.dataset.value, el.hasAttribute('data-sensitive')),
  'receive-format': (el) => {
    state.receiveFormat = el.dataset.format;
    render();
  },
  max: (el) =>
    withBusy(el, async () => {
      const n = net();
      const balance = await fetchBalance(n, accounts()).catch(() => state.balance.value);
      if (balance == null) return toast('Balance unavailable', 'error');
      state.balance.value = balance;
      const max = await estimateMaxSendable(n, balance);
      const input = document.getElementById('amount');
      input.value = formatUnits(max, n.decimals, n.decimals);
      state.draft.amount = input.value;
      if (max === 0n) toast('Not enough balance to cover the network fee', 'error');
    }),
  reveal: (el) => {
    state.secret = { type: el.dataset.type, data: null, revealed: false };
    go('reveal-gate');
  },
  lock: () => lock(),
  done: () => resetTo('home'),
};

const inputs = {
  phrase: updatePhraseStatus,
  recipient: (el) => {
    if (/\s/.test(el.value)) el.value = el.value.replace(/\s+/g, '');
    state.draft.to = el.value.trim();
    document.getElementById('routeHint').innerHTML = routeHintHtml(state.draft.to);
  },
  amount: (el) => {
    const clean = el.value.replace(/,/g, '.').replace(/[^\d.]/g, '');
    if (clean !== el.value) el.value = clean;
    state.draft.amount = clean;
  },
  strength: (el) => {
    const meter = document.getElementById('strength');
    if (!meter) return;
    const level = passwordStrength(el.value);
    meter.dataset.level = String(level);
    meter.querySelector('em').textContent = el.value
      ? ['', 'Too short', 'Fair', 'Good', 'Strong'][level]
      : '';
  },
  'reset-confirm': (el) => {
    document.getElementById('resetConfirm').disabled = el.value.trim().toUpperCase() !== 'RESET';
  },
};

const changes = {
  'phrase-saved': (el) => {
    document.getElementById('phraseContinue').disabled = !(el.checked && state.flow?.revealed);
  },
  'mainnet-confirm': (el) => {
    document.getElementById('confirmBtn').disabled = !el.checked;
  },
};

const forms = {
  unlock: (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      try {
        const keyring = await store.unlockKeyring(form.pw.value);
        await openKeyring(keyring);
      } catch {
        form.pw.value = '';
        form.pw.focus();
        showError(form, 'Incorrect password. Try again.');
        form.querySelector('.control')?.classList.add('shake');
      }
    }),

  import: (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      const mnemonic = normalizeMnemonic(form.phrase.value);
      if (!(await validateMnemonic(mnemonic)))
        return showError(
          form,
          'That recovery phrase isn’t valid. Check each word and their order.',
        );
      if (!state.flow.initial) {
        try {
          await addWalletToKeyring(mnemonic, form.walletName?.value || '');
        } catch (e) {
          showError(form, friendlyError(e, 'Could not import this wallet.'));
        }
        return;
      }
      state.flow.mnemonic = mnemonic;
      go('set-password');
    }),

  'set-password': (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      try {
        const pw = checkNewPassword(form);
        if (!form.termsCheck.checked)
          throw new Error('Please accept the Terms of Use to continue.');
        const { mnemonic, kind } = state.flow;
        const w = {
          id: crypto.randomUUID(),
          name: 'Wallet 1',
          mnemonic,
          accounts: await deriveAccounts(mnemonic),
        };
        const keyring = await store.createKeyring(w, pw);
        await openKeyring(keyring);
        toast(kind === 'import' ? 'Wallet imported' : 'Your wallet is ready');
      } catch (e) {
        showError(form, friendlyError(e, 'Could not create the wallet.'));
      }
    }),

  'name-wallet': (form, button) =>
    withBusy(button, async () => {
      try {
        await addWalletToKeyring(state.flow.mnemonic, form.walletName.value);
      } catch (e) {
        showError(form, friendlyError(e, 'Could not add this wallet.'));
      }
    }),

  send: (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      const n = net();
      try {
        const amountText = form.amount.value.trim();
        if (!amountText) throw new Error('Enter an amount.');
        const amount = parseUnits(amountText, n.decimals);
        state.draft = { to: form.to.value.trim(), amount: amountText };
        const pending = await prepareTransfer({
          net: n,
          accounts: accounts(),
          mnemonic: wallet().mnemonic,
          to: state.draft.to,
          amount,
        });
        state.pending = { ...pending, walletId: wallet().id };
        state.balance.value = pending.balance;
        go('review');
      } catch (e) {
        showError(
          form,
          friendlyError(e, 'Could not prepare the transaction. Check your connection.'),
        );
      }
    }),

  confirm: (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      const p = state.pending,
        n = NETWORKS[p?.network];
      try {
        if (!p || p.network !== state.network || p.walletId !== wallet().id)
          throw new Error('The network or wallet changed. Review the transaction again.');
        if (isMainnet(n) && !form.mainnetCheck?.checked)
          throw new Error('Confirm that you have verified the transaction.');
        button.querySelector('span').textContent = 'Sending…';
        const hash = await submitTransfer(n, p, wallet().mnemonic);
        state.result = { network: p.network, amount: p.amount, to: p.to, hash };
        state.pending = null;
        state.draft = { to: '', amount: '' };
        resetData();
        state.history = ['home'];
        go('result', { replace: true });
      } catch (e) {
        if (button.isConnected) button.querySelector('span').textContent = 'Confirm & send';
        showError(form, friendlyError(e, 'The transaction could not be submitted.'));
      }
    }),

  reveal: (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      try {
        await store.verifyPassword(form.pw.value);
      } catch {
        form.pw.value = '';
        return showError(form, 'Incorrect password.');
      }
      if (state.secret.type === 'keys')
        state.secret.data = await exportWalletSecrets(wallet().mnemonic);
      state.secret.revealed = false;
      go('reveal', { replace: true });
    }),

  'change-password': (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      try {
        const pw = checkNewPassword(form);
        try {
          await store.verifyPassword(form.current.value);
        } catch {
          throw new Error('Current password is incorrect.');
        }
        await store.changePassword(state.keyring, form.current.value, pw);
        await store.startSession(state.keyring, state.prefs.autoLock);
        back();
        toast('Password updated');
      } catch (e) {
        showError(form, friendlyError(e, 'Could not change the password.'));
      }
    }),

  'rename-wallet': (form, button) =>
    withBusy(button, async () => {
      const w = state.keyring.wallets.find((x) => x.id === state.editWalletId);
      const name = form.walletName.value.trim();
      if (!name) return showError(form, 'Enter a name.');
      w.name = name;
      await state.keyring.save();
      back();
      toast('Wallet updated');
    }),

  'remove-wallet': (form, button) =>
    withBusy(button, async () => {
      clearError(form);
      try {
        await store.verifyPassword(form.pw.value);
      } catch {
        form.pw.value = '';
        return showError(form, 'Incorrect password.');
      }
      const k = state.keyring;
      if (k.wallets.length < 2) return;
      const removed = k.wallets.find((w) => w.id === state.editWalletId);
      k.wallets = k.wallets.filter((w) => w.id !== state.editWalletId);
      if (!k.wallets.some((w) => w.id === k.activeWalletId)) k.activeWalletId = k.wallets[0].id;
      await k.save();
      resetData();
      state.modal = null;
      state.history = ['home', 'settings'];
      go('wallets', { replace: true });
      toast(`${removed?.name || 'Wallet'} removed`);
    }),

  reset: async (form) => {
    if (form.confirmText.value.trim().toUpperCase() !== 'RESET') return;
    await store.resetWallet();
    state.keyring = null;
    state.modal = null;
    resetData();
    resetTo('welcome');
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  touch();
  if (!el || el.disabled) return;
  // Clicks inside a sheet or modal bubble up to the backdrop; only the backdrop itself closes it.
  if (el.classList.contains('overlay') && e.target !== el) return;
  const handler = actions[el.dataset.action];
  if (!handler) return;
  if (el.tagName !== 'A') e.preventDefault();
  Promise.resolve(handler(el, e)).catch((err) =>
    toast(friendlyError(err, 'Something went wrong.'), 'error'),
  );
});
app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target,
    handler = forms[form.dataset.form];
  const button = e.submitter || form.querySelector('[type="submit"]');
  if (handler && !button?.disabled)
    Promise.resolve(handler(form, button)).catch((err) =>
      showError(form, friendlyError(err, 'Something went wrong.')),
    );
});
app.addEventListener('input', (e) => {
  touch();
  inputs[e.target.dataset.input]?.(e.target);
  e.target.closest('.control')?.classList.remove('shake');
});
app.addEventListener('change', (e) => changes[e.target.dataset.change]?.(e.target));
document.addEventListener('keydown', (e) => {
  // Addresses and phrases use textareas for readability; Enter still submits.
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('textarea')) {
    e.preventDefault();
    e.target.form?.requestSubmit();
    return;
  }
  if (e.key !== 'Escape' || !(state.sheet || state.modal)) return;
  e.preventDefault();
  state.sheet = null;
  state.modal = null;
  render();
});

// The background worker clears the session when the auto-lock timer fires.
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === 'session' &&
    changes.unlocked &&
    !changes.unlocked.newValue &&
    state.keyring &&
    state.prefs.autoLock
  ) {
    state.keyring = null;
    resetData();
    state.draft = { to: '', amount: '' };
    resetTo('unlock');
  }
});

async function boot() {
  try {
    const { prefs, selectedNetwork } = await store.loadPrefs();
    state.prefs = prefs;
    if (NETWORKS[selectedNetwork]) state.network = selectedNetwork;
    applyTheme();
    const keyring = await store.resumeSession();
    if (keyring) {
      state.keyring = keyring;
      resetTo('home');
      store.touchSession(state.prefs.autoLock).catch(() => {});
      return;
    }
    resetTo((await store.hasVault()) ? 'unlock' : 'welcome');
  } catch {
    resetTo('welcome');
  }
}

boot();
