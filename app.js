import {
  createMnemonic,
  validateMnemonic,
  deriveAccounts,
  encryptVault,
  decryptVault,
  parseUnits,
  formatUnits,
  isEvmAddress,
  signLegacyTransfer,
  cborEncode,
  cborDecode,
  buildConsensusTransfer,
  getConsensusPublicKey,
  signConsensusTransfer,
  signRuntimeTransfer,
  decodeOasisAddress,
  fromHex,
  exportWalletSecrets,
} from './crypto.js';
import {qrSvg} from './qr.js';

const app = document.querySelector('#app');
const REPO_URL = 'https://github.com/huralya/Oasis-Wallet';
const TERMS_URL = `${REPO_URL}/blob/main/TERMS.md`;
const HURALYA_URL = 'https://huralya.com';
const SAPPHIRE_MAINNET_RUNTIME = '000000000000000000000000000000000000000000000000f80306c9858e7279';
const SAPPHIRE_TESTNET_RUNTIME = '000000000000000000000000000000000000000000000000a6d1e3ebf60dff6c';

const NETWORKS = {
  'sapphire-mainnet': {
    key: 'sapphire-mainnet', layer: 'Sapphire', env: 'Mainnet', kind: 'sapphire', symbol: 'ROSE', decimals: 18,
    chainId: 23294, rpc: 'https://sapphire.oasis.io', nexus: 'https://nexus.oasis.io/v1', grpc: 'https://grpc.oasis.io',
    chainContext: 'bb3d748def55bdfb797a2ac53ee6ee141e54cd2ab2dc2375f4a0703a178e6e55', runtimeId: SAPPHIRE_MAINNET_RUNTIME,
    runtimeGas: 70000n, runtimeGasPrice: 100n, accent: 'sapphire',
  },
  'consensus-mainnet': {
    key: 'consensus-mainnet', layer: 'Consensus', env: 'Mainnet', kind: 'consensus', symbol: 'ROSE', decimals: 9,
    nexus: 'https://nexus.oasis.io/v1', grpc: 'https://grpc.oasis.io',
    chainContext: 'bb3d748def55bdfb797a2ac53ee6ee141e54cd2ab2dc2375f4a0703a178e6e55', accent: 'consensus',
  },
  'sapphire-testnet': {
    key: 'sapphire-testnet', layer: 'Sapphire', env: 'Testnet', kind: 'sapphire', symbol: 'TEST', decimals: 18,
    chainId: 23295, rpc: 'https://testnet.sapphire.oasis.io', nexus: 'https://testnet.nexus.oasis.io/v1', grpc: 'https://testnet.grpc.oasis.io',
    chainContext: '0b91b8e4e44b2003a7c5e23ddadb5e14ef5345c0ebcb3ddcae07fa2f244cab76', runtimeId: SAPPHIRE_TESTNET_RUNTIME,
    runtimeGas: 70000n, runtimeGasPrice: 100n, accent: 'sapphire',
  },
  'consensus-testnet': {
    key: 'consensus-testnet', layer: 'Consensus', env: 'Testnet', kind: 'consensus', symbol: 'TEST', decimals: 9,
    nexus: 'https://testnet.nexus.oasis.io/v1', grpc: 'https://testnet.grpc.oasis.io',
    chainContext: '0b91b8e4e44b2003a7c5e23ddadb5e14ef5345c0ebcb3ddcae07fa2f244cab76', accent: 'consensus',
  },
};

let state = {
  screen: 'boot', network: 'sapphire-testnet', networkMenu: false, accountMenu: false,
  vaultData: null, pending: null, pendingWallet: null, txResult: null,
  balance: null, loadingBalance: false, activity: [], loadingActivity: false, activityError: null,
  busy: false, secretType: null, secretData: null, previousScreen: 'home',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const short = (a, left = 8, right = 6) => a ? `${a.slice(0, left)}…${a.slice(-right)}` : '';
const currentNet = () => NETWORKS[state.network];
const isMainnet = (net = currentNet()) => net.env === 'Mainnet';
const activeWallet = () => state.vaultData?.wallets?.find(w => w.id === state.vaultData.activeWalletId) || state.vaultData?.wallets?.[0] || null;
const activeAccounts = () => activeWallet()?.accounts || null;
const primaryAddress = (net = currentNet()) => net.kind === 'sapphire' ? activeAccounts()?.sapphireNative : activeAccounts()?.consensus;
const alternateAddress = (net = currentNet()) => net.kind === 'sapphire' ? activeAccounts()?.eth : null;
const activeMnemonic = () => activeWallet()?.mnemonic || null;
const formatBalance = (amount, decimals = 6) => amount == null ? '—' : formatUnits(amount, currentNet().decimals, decimals);
const toRpcHex = (n) => `0x${BigInt(n).toString(16)}`;
const bytesToHex = (bytes) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const walletName = (w = activeWallet()) => w?.name || 'Wallet';
const walletIndex = (w = activeWallet()) => Math.max(0, state.vaultData?.wallets?.findIndex(x => x.id === w?.id) ?? 0);
const randomId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const icon = (name) => {
  const paths = {
    down:'<path d="M12 3v14m0 0 5-5m-5 5-5-5M5 21h14"/>', up:'<path d="M12 21V7m0 0 5 5m-5-5-5 5M5 3h14"/>',
    refresh:'<path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.5-2.4L20 11M4 13l2.4 4.4A7 7 0 0 0 17.9 15"/>',
    lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    copy:'<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
    check:'<path d="m5 12 4 4L19 6"/>', chevron:'<path d="m9 10 3 3 3-3"/>', arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    external:'<path d="M14 5h5v5M10 14l9-9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.5 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.1A1.7 1.7 0 0 0 4 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.4 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4v.1A1.7 1.7 0 0 0 15 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.4c.14.36.35.69.63.96.3.27.68.41 1.08.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', key:'<circle cx="8" cy="15" r="3"/><path d="m10.5 12.5 8-8M15 8l2 2M17 6l2 2"/>',
    eye:'<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
    wallet:'<path d="M4 7a2 2 0 0 1 2-2h12v14H6a2 2 0 0 1-2-2V7Z"/><path d="M15 10h5v4h-5a2 2 0 1 1 0-4Z"/>',
    shield:'<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    edit:'<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/>',
  };
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
};

function footer() {
  return `<footer class="footer footer-v3">
    <a href="${HURALYA_URL}" target="_blank" rel="noopener noreferrer">Developed by Huralya</a>
    <span>·</span><a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
    <span>·</span><a href="${TERMS_URL}" target="_blank" rel="noopener noreferrer">Terms</a>
  </footer>`;
}
function shell(content, {compact=false}={}) { return `<main class="shell ${compact?'compact':''}">${content}${footer()}</main>`; }
function brand() { return `<div class="brand"><img src="oasis-mark.svg" alt="Oasis" class="brandmark"><span>Oasis Wallet</span></div>`; }
function networkPill(net=currentNet(), disabled=false) {
  return `<button class="network-pill ${isMainnet(net)?'mainnet':''}" id="networkBtn" ${disabled?'disabled':''} aria-label="Select network"><span class="network-dot ${net.accent}"></span><span class="network-label"><b>${esc(net.layer)}</b><small>${esc(net.env)}</small></span>${icon('chevron')}</button>`;
}
function header({back=null, network=true, disableNetwork=false, settings=true}={}) {
  if (back) return `<header class="header subheader"><button class="round-btn" id="backBtn" aria-label="Back">←</button><div class="subhead-title">${esc(back)}</div>${network && activeWallet()?networkPill(currentNet(),disableNetwork):'<span></span>'}</header>`;
  return `<header class="header">${brand()}<div class="header-actions">${activeWallet()&&network?networkPill():''}${activeWallet()&&settings?`<button class="round-btn" id="settingsBtn" aria-label="Settings">${icon('settings')}</button>`:''}</div></header>`;
}

function networkMenu() {
  if (!state.networkMenu) return '';
  const row=(key)=>{const n=NETWORKS[key];return `<button class="network-option ${state.network===key?'selected':''}" data-network="${key}"><span class="network-icon ${n.accent}">${n.kind==='sapphire'?'S':'C'}</span><span class="network-option-text"><b>${n.layer}</b><small>${n.env==='Mainnet'?'Mainnet · real ROSE':'Testnet · TEST tokens'}</small></span>${state.network===key?`<span class="selected-check">${icon('check')}</span>`:''}</button>`};
  return `<div class="overlay" id="networkOverlay"><div class="network-sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div><div class="sheet-title">Select network</div><div class="group-label">MAINNET</div>${row('sapphire-mainnet')}${row('consensus-mainnet')}<div class="group-label">TESTNET</div>${row('sapphire-testnet')}${row('consensus-testnet')}</div></div>`;
}
function accountMenu() {
  if (!state.accountMenu) return '';
  const wallets=state.vaultData?.wallets||[];
  return `<div class="overlay" id="accountOverlay"><div class="network-sheet account-sheet" role="dialog" aria-modal="true"><div class="sheet-handle"></div><div class="sheet-title-row"><div><div class="sheet-title">Wallets</div><div class="sheet-subtitle">Each wallet has its own recovery phrase.</div></div><button class="tiny-icon-btn" id="addWalletFromSheet">${icon('plus')}</button></div>
    <div class="wallet-list">${wallets.map((w,i)=>{const addr=currentNet().kind==='sapphire'?w.accounts.sapphireNative:w.accounts.consensus;return `<button class="wallet-option ${w.id===state.vaultData.activeWalletId?'selected':''}" data-wallet-id="${esc(w.id)}"><span class="wallet-avatar">${i+1}</span><span class="wallet-option-text"><b>${esc(w.name)}</b><small>${esc(short(addr,8,6))}</small></span>${w.id===state.vaultData.activeWalletId?`<span class="selected-check">${icon('check')}</span>`:''}</button>`}).join('')}</div>
    <button class="btn secondary wide add-wallet-sheet" id="addWalletBtn">${icon('plus')} Add another wallet</button>
  </div></div>`;
}

function welcome() {
  return shell(`${header({network:false,settings:false})}<section class="welcome"><div class="welcome-mark"><img src="oasis-mark.svg" alt=""></div><div class="eyebrow">CONSENSUS + SAPPHIRE</div><h1>One wallet for<br>Oasis Network.</h1><p>Native Oasis addresses first, with Sapphire and Consensus managed in one secure extension.</p><div class="welcome-actions"><button class="btn primary" id="createBtn">Create a new wallet</button><button class="btn secondary" id="importBtn">Import existing wallet</button></div><div class="security-note"><span class="security-icon">✓</span><span>Non-custodial. Encrypted locally. No analytics.</span></div></section>`,{compact:true});
}
function passwordForm(mode) {
  const create=mode==='create';
  return shell(`${header({back:create?'Create wallet':'Import wallet',network:false})}<section class="page-body"><div class="step-pill">${create?'1 of 2':'Restore'}</div><h2>${create?'Protect this browser':'Restore your wallet'}</h2><p class="lead">${create?'Choose any password. A long, unique password is strongly recommended.':'Enter your recovery phrase and choose a local password.'}</p>${create?'':`<label class="field-label" for="mnemonic">Recovery phrase</label><div class="field"><textarea id="mnemonic" class="input textarea" autocomplete="off" spellcheck="false" placeholder="Enter 12, 15, 18, 21 or 24 words"></textarea></div>`}<label class="field-label" for="pw">Password</label><div class="field"><input id="pw" class="input" type="password" autocomplete="new-password" placeholder="Choose a password"></div><div class="field-help">No minimum length is enforced. Use a long unique password for real funds.</div><label class="field-label" for="pw2">Confirm password</label><div class="field"><input id="pw2" class="input" type="password" autocomplete="new-password" placeholder="Repeat password"></div><div id="msg"></div><button class="btn primary wide" id="continueBtn">Continue ${icon('arrow')}</button></section>`);
}
function backup() {
  const words=state.pendingWallet?.mnemonic?.split(' ')||[];
  return shell(`${header({back:'Recovery phrase',network:false})}<section class="page-body"><div class="step-pill">2 of 2</div><h2>Back up these words</h2><p class="lead">This recovery phrase controls this wallet. Store it offline.</p><div class="danger-banner"><b>Never share it.</b> Anyone with these words can move your funds.</div><div class="words">${words.map((w,i)=>`<div class="word"><span>${i+1}</span><b>${esc(w)}</b></div>`).join('')}</div><label class="check-row"><input type="checkbox" id="savedCheck"><span>I saved my recovery phrase somewhere safe.</span></label><button class="btn primary wide" id="finishBtn" disabled>Open Oasis Wallet</button></section>`);
}
function unlock() {
  return shell(`${header({network:false,settings:false})}<section class="unlock-wrap"><div class="unlock-mark"><img src="oasis-mark.svg" alt=""></div><h1>Welcome back</h1><p>Enter your password to unlock Oasis Wallet.</p><div class="field"><input id="pw" class="input" type="password" autocomplete="current-password" placeholder="Password" autofocus></div><div id="msg"></div><button class="btn primary wide" id="unlockBtn">Unlock</button><button class="text-btn" id="resetBtn">Reset wallet on this browser</button></section>`,{compact:true});
}
function accountChip() {
  const w=activeWallet(),addr=primaryAddress();
  return `<div class="account-row"><button class="account-chip account-switch" id="accountBtn"><span class="avatar">${walletIndex(w)+1}</span><span><b>${esc(walletName(w))}</b><small>${esc(short(addr,7,5))}</small></span>${icon('chevron')}</button><button class="address-copy-btn copy" data-copy="${esc(addr)}" title="Copy native address">${icon('copy')}</button></div>`;
}
function activityRows() {
  if (state.loadingActivity) return `<div class="activity-loading"><span class="skeleton activity-sk"></span><span class="skeleton activity-sk"></span><span class="skeleton activity-sk"></span></div>`;
  if (state.activityError) return `<div class="empty-activity"><span>!</span><div><b>Couldn’t load activity</b><small>${esc(state.activityError)}</small></div><button class="mini-retry" id="activityRetry">Retry</button></div>`;
  if (!state.activity.length) return `<div class="empty-activity"><span>↗</span><div><b>No transactions yet</b><small>Incoming and outgoing network activity will appear here.</small></div></div>`;
  return `<div class="activity-list">${state.activity.map(tx=>{
    const sign=tx.direction==='out'?'−':tx.direction==='in'?'+':'';
    const amount=tx.amount!=null?`${sign}${formatUnits(tx.amount,currentNet().decimals,6)} ${currentNet().symbol}`:(tx.method||'Transaction');
    return `<a class="activity-row" href="${esc(tx.url)}" target="_blank" rel="noopener noreferrer"><span class="activity-icon ${tx.direction}">${tx.direction==='out'?'↑':tx.direction==='in'?'↓':'↗'}</span><span class="activity-main"><b>${tx.direction==='out'?'Sent':tx.direction==='in'?'Received':'Transaction'}</b><small>${esc(tx.time)}</small></span><span class="activity-meta"><b>${esc(amount)}</b><small>${esc(short(tx.hash,7,5))} ${icon('external')}</small></span></a>`;
  }).join('')}</div>`;
}
function home() {
  const net=currentNet();
  const balance=state.loadingBalance?`<span class="skeleton balance-skeleton"></span>`:`<span>${formatBalance(state.balance)}</span><small>${net.symbol}</small>`;
  return shell(`${header()}<section class="home">${accountChip()}<div class="balance-zone"><div class="network-context"><span class="network-dot ${net.accent}"></span>${net.layer}<span>·</span>${net.env}${isMainnet(net)?'<b class="real-chip">REAL FUNDS</b>':''}</div><div class="hero-balance">${balance}</div><div class="balance-caption">Available balance</div></div><div class="action-grid"><button class="wallet-action" id="sendBtn"><span class="action-icon">${icon('up')}</span><b>Send</b></button><button class="wallet-action" id="receiveBtn"><span class="action-icon">${icon('down')}</span><b>Receive</b></button><button class="wallet-action" id="refreshBtn"><span class="action-icon">${icon('refresh')}</span><b>Refresh</b></button></div><div class="info-card"><div><span class="network-icon ${net.accent}">${net.kind==='sapphire'?'S':'C'}</span><span><b>${net.layer}</b><small>${net.kind==='sapphire'?'Native oasis1 address · EVM compatible':'Oasis Consensus base layer'}</small></span></div><div class="info-address copy" data-copy="${esc(primaryAddress())}">${esc(short(primaryAddress(),10,8))}${icon('copy')}</div></div><div class="activity-card"><div class="section-title"><b>Activity</b><button class="section-action" id="activityRefresh">Refresh</button></div>${activityRows()}</div></section>${networkMenu()}${accountMenu()}`);
}
function receive() {
  const net=currentNet(),sapphire=net.kind==='sapphire',address=primaryAddress();
  let qr=''; try{qr=qrSvg(address,{scale:5,margin:4});}catch{qr='<div class="qr-fallback">QR unavailable</div>'}
  return shell(`${header({back:'Receive'})}<section class="page-body receive-page"><h2>Receive ${net.symbol}</h2><p class="lead center-text">Receive on <b>${net.layer} ${net.env}</b>.</p><div class="qr-card"><div class="qr-frame">${qr}</div><div class="address-label">${sapphire?'Native Sapphire address':'Consensus address'}</div><div class="full-address native-address">${esc(address)}</div><button class="btn secondary wide copy" data-copy="${esc(address)}">${icon('copy')} Copy native address</button></div>${sapphire?`<div class="alternate-card"><div><b>EVM address</b><small>Same Sapphire account in 0x format.</small></div><button class="mini-copy copy" data-copy="${esc(alternateAddress())}">${esc(short(alternateAddress(),8,6))} ${icon('copy')}</button></div>`:''}<div class="network-warning ${isMainnet(net)?'mainnet':''}"><span class="network-dot ${net.accent}"></span><span>${isMainnet(net)?'Mainnet uses real ROSE. Verify the selected network before receiving.':'Testnet only. Send TEST tokens on this exact network.'}</span></div></section>${networkMenu()}`);
}
function send() {
  const net=currentNet();
  const hint=net.kind==='sapphire'?'oasis1… or 0x…':'oasis1… address';
  return shell(`${header({back:'Send'})}<section class="page-body send-page"><div class="send-balance"><span>Available</span><b>${state.balance==null?'—':formatUnits(state.balance,net.decimals,6)} ${net.symbol}</b></div>${isMainnet(net)?`<div class="mainnet-banner"><span>●</span><div><b>Mainnet</b><small>This transaction uses real ROSE.</small></div></div>`:''}<label class="field-label" for="recipient">Recipient</label><div class="field"><input id="recipient" class="input mono" autocomplete="off" spellcheck="false" placeholder="${hint}"></div>${net.kind==='sapphire'?'<div class="field-help">Native <b>oasis1</b> is the default. EVM <b>0x</b> addresses are also supported.</div>':'<div class="field-help">Use a Consensus oasis1 address.</div>'}<label class="field-label" for="amount">Amount</label><div class="amount-field"><input id="amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.0"><span>${net.symbol}</span><button id="maxBtn">MAX</button></div><div id="msg"></div><button class="btn primary wide" id="reviewBtn">Review transaction ${icon('arrow')}</button></section>${networkMenu()}`);
}
function review() {
  const p=state.pending;if(!p)return home();const net=NETWORKS[p.network],total=p.amount+p.fee;
  return shell(`${header({back:'Review transaction',disableNetwork:true})}<section class="page-body review-page"><div class="review-amount"><small>You send</small><b>${formatUnits(p.amount,net.decimals,8)} <span>${net.symbol}</span></b><div>${net.layer} · ${net.env}${p.mode==='runtime'?' · Native':''}</div></div><div class="review-card"><div class="review-row"><span>From</span><b>${esc(short(p.from,10,8))}</b></div><div class="review-row"><span>To</span><b>${esc(short(p.to,10,8))}</b></div><div class="review-row"><span>Route</span><b>${p.mode==='runtime'?'Native Oasis':p.mode==='evm'?'Sapphire EVM':'Consensus'}</b></div><div class="review-row"><span>Network fee</span><b>${p.fee===0n?'0':`≈ ${formatUnits(p.fee,net.decimals,10)}`} ${net.symbol}</b></div><div class="review-row total"><span>Total</span><b>${formatUnits(total,net.decimals,8)} ${net.symbol}</b></div></div>${isMainnet(net)?`<label class="mainnet-confirm"><input type="checkbox" id="mainnetConfirm"><span><b>I understand this is Mainnet.</b><small>Verify the recipient and amount. Transactions are irreversible.</small></span></label>`:'<div class="testnet-confirm">Testnet transaction · no real ROSE will be used.</div>'}<div id="msg"></div><button class="btn primary wide" id="confirmSendBtn" ${isMainnet(net)?'disabled':''}>Confirm & Send</button><button class="btn ghost wide" id="editSendBtn">Edit transaction</button></section>`);
}
function explorerTxUrl(net,hash) {
  const env=net.env.toLowerCase();
  if(net.kind==='sapphire') return `https://explorer.oasis.io/${env}/sapphire/tx/${String(hash)}`;
  return `https://explorer.oasis.io/${env}/consensus/tx/${String(hash).replace(/^0x/,'')}`;
}
function success() {
  const r=state.txResult,net=r?NETWORKS[r.network]:currentNet(),url=r?explorerTxUrl(net,r.hash):'#';
  return shell(`${header({network:false})}<section class="success-page"><div class="success-ring">${icon('check')}</div><div class="eyebrow">TRANSACTION SUBMITTED</div><h1>${formatUnits(r.amount,net.decimals,8)} ${net.symbol}</h1><p>${net.layer} · ${net.env}</p><div class="hash-card"><span>Transaction hash</span><button class="copy hash-copy" data-copy="${esc(r.hash)}">${esc(short(r.hash,12,10))}${icon('copy')}</button></div><a class="btn secondary wide explorer-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View on Oasis Explorer ${icon('external')}</a><button class="btn primary wide" id="doneBtn">Done</button></section>`);
}

function settings() {
  return shell(`${header({back:'Settings',network:false,settings:false})}<section class="page-body settings-page"><div class="settings-profile"><span class="wallet-avatar large">${walletIndex()+1}</span><div><b>${esc(walletName())}</b><small>${esc(short(primaryAddress(),10,8))}</small></div></div><div class="settings-section"><div class="settings-label">SECURITY</div><button class="settings-row" data-secret="recovery"><span class="settings-icon">${icon('shield')}</span><span><b>Recovery phrase</b><small>Reveal and back up this wallet</small></span><span>›</span></button><button class="settings-row" data-secret="keys"><span class="settings-icon">${icon('key')}</span><span><b>Private keys</b><small>Export Sapphire and Consensus keys</small></span><span>›</span></button><button class="settings-row" id="changePasswordBtn"><span class="settings-icon">${icon('lock')}</span><span><b>Change password</b><small>Re-encrypt all wallets on this browser</small></span><span>›</span></button></div><div class="settings-section"><div class="settings-label">WALLETS</div><button class="settings-row" id="addWalletSettings"><span class="settings-icon">${icon('plus')}</span><span><b>Add wallet</b><small>Create or import a separate recovery phrase</small></span><span>›</span></button></div><div class="settings-section"><div class="settings-label">ABOUT</div><a class="settings-row" href="${REPO_URL}" target="_blank" rel="noopener noreferrer"><span class="settings-icon">${icon('wallet')}</span><span><b>Open-source repository</b><small>huralya/Oasis-Wallet</small></span>${icon('external')}</a><a class="settings-row" href="${TERMS_URL}" target="_blank" rel="noopener noreferrer"><span class="settings-icon">§</span><span><b>Terms of Use</b><small>Read the current terms on GitHub</small></span>${icon('external')}</a></div><button class="btn secondary wide" id="lockSettingsBtn">${icon('lock')} Lock wallet</button></section>`);
}
function addWallet() {
  return shell(`${header({back:'Add wallet',network:false,settings:false})}<section class="page-body add-wallet-page"><h2>Add another wallet</h2><p class="lead">Each wallet is fully separate and has its own recovery phrase and private keys.</p><button class="choice-card" id="createAnotherBtn"><span class="choice-icon">${icon('plus')}</span><span><b>Create new wallet</b><small>Generate a new recovery phrase</small></span><span>›</span></button><button class="choice-card" id="importAnotherBtn"><span class="choice-icon">${icon('down')}</span><span><b>Import wallet</b><small>Use an existing recovery phrase</small></span><span>›</span></button></section>`);
}
function addImport() {
  const defaultName=`Wallet ${(state.vaultData?.wallets?.length||0)+1}`;
  return shell(`${header({back:'Import wallet',network:false,settings:false})}<section class="page-body"><label class="field-label" for="walletName">Wallet name</label><div class="field"><input id="walletName" class="input" value="${esc(defaultName)}" maxlength="40"></div><label class="field-label" for="mnemonic">Recovery phrase</label><div class="field"><textarea id="mnemonic" class="input textarea" autocomplete="off" spellcheck="false" placeholder="Enter recovery phrase"></textarea></div><label class="field-label" for="currentPw">Current password</label><div class="field"><input id="currentPw" class="input" type="password" autocomplete="current-password" placeholder="Confirm current password"></div><div id="msg"></div><button class="btn primary wide" id="importAnotherConfirm">Import wallet</button></section>`);
}
function addBackup() {
  const words=state.pendingWallet?.mnemonic?.split(' ')||[],defaultName=`Wallet ${(state.vaultData?.wallets?.length||0)+1}`;
  return shell(`${header({back:'New wallet backup',network:false,settings:false})}<section class="page-body"><div class="danger-banner"><b>Separate recovery phrase.</b> This wallet cannot be recovered with your other wallets.</div><div class="words compact-words">${words.map((w,i)=>`<div class="word"><span>${i+1}</span><b>${esc(w)}</b></div>`).join('')}</div><label class="field-label" for="walletName">Wallet name</label><div class="field"><input id="walletName" class="input" value="${esc(defaultName)}" maxlength="40"></div><label class="field-label" for="currentPw">Current password</label><div class="field"><input id="currentPw" class="input" type="password" autocomplete="current-password" placeholder="Confirm current password"></div><label class="check-row"><input type="checkbox" id="savedCheck"><span>I saved this recovery phrase.</span></label><div id="msg"></div><button class="btn primary wide" id="saveAnotherBtn" disabled>Add wallet</button></section>`);
}
function verifySecret() {
  const label=state.secretType==='recovery'?'recovery phrase':'private keys';
  return shell(`${header({back:'Verify password',network:false,settings:false})}<section class="page-body sensitive-gate"><div class="sensitive-icon">${state.secretType==='recovery'?icon('shield'):icon('key')}</div><h2>Reveal ${label}</h2><p class="lead center-text">For security, confirm your wallet password first.</p><div class="field"><input id="verifyPw" class="input" type="password" autocomplete="current-password" placeholder="Password" autofocus></div><div id="msg"></div><button class="btn primary wide" id="revealBtn">Continue</button></section>`);
}
function secretDisplay() {
  const w=activeWallet();
  if(state.secretType==='recovery') {
    const words=w.mnemonic.split(' ');
    return shell(`${header({back:'Recovery phrase',network:false,settings:false})}<section class="page-body"><div class="danger-banner"><b>Do not share these words.</b> Anyone with them can control ${esc(w.name)}.</div><div class="words">${words.map((x,i)=>`<div class="word"><span>${i+1}</span><b>${esc(x)}</b></div>`).join('')}</div><button class="btn secondary wide copy" data-copy="${esc(w.mnemonic)}">${icon('copy')} Copy recovery phrase</button></section>`);
  }
  const k=state.secretData||{};
  return shell(`${header({back:'Private keys',network:false,settings:false})}<section class="page-body"><div class="danger-banner"><b>Private keys are equivalent to funds.</b> Never paste them into websites or support chats.</div><div class="secret-card"><div class="secret-head"><span>Sapphire</span><b>secp256k1 private key</b></div><div class="secret-value">${esc(k.sapphirePrivateKey)}</div><button class="mini-action copy" data-copy="${esc(k.sapphirePrivateKey)}">${icon('copy')} Copy</button></div><div class="secret-card"><div class="secret-head"><span>Consensus</span><b>Ed25519 private seed</b></div><div class="secret-value">${esc(k.consensusPrivateSeed)}</div><button class="mini-action copy" data-copy="${esc(k.consensusPrivateSeed)}">${icon('copy')} Copy</button></div></section>`);
}
function changePassword() {
  return shell(`${header({back:'Change password',network:false,settings:false})}<section class="page-body"><h2>Change local password</h2><p class="lead">This re-encrypts every wallet stored in this extension. It does not change any blockchain keys.</p><label class="field-label">Current password</label><div class="field"><input id="currentPw" class="input" type="password" autocomplete="current-password"></div><label class="field-label">New password</label><div class="field"><input id="newPw" class="input" type="password" autocomplete="new-password" placeholder="Any non-empty password"></div><div class="field-help">No minimum length is enforced. A long unique password remains strongly recommended.</div><label class="field-label">Confirm new password</label><div class="field"><input id="newPw2" class="input" type="password" autocomplete="new-password"></div><div id="msg"></div><button class="btn primary wide" id="savePasswordBtn">Change password</button></section>`);
}

function render() {
  const map={welcome,create:()=>passwordForm('create'),import:()=>passwordForm('import'),backup,unlock,home,receive,send,review,success,settings,addWallet,addImport,addBackup,verifySecret,secretDisplay,changePassword};
  app.innerHTML=(map[state.screen]||welcome)();bind();
}
function setMessage(text,kind='error'){const el=document.querySelector('#msg');if(el)el.innerHTML=`<div class="form-message ${kind}">${esc(text)}</div>`;}
function serializableVault(){return{version:2,activeWalletId:state.vaultData.activeWalletId,wallets:state.vaultData.wallets.map(w=>({id:w.id,name:w.name,mnemonic:w.mnemonic}))};}
async function hydrateVault(raw){
  let data;
  try{const parsed=JSON.parse(raw);if(parsed?.version>=2&&Array.isArray(parsed.wallets))data=parsed;}catch{}
  if(!data)data={version:2,activeWalletId:'wallet-1',wallets:[{id:'wallet-1',name:'Wallet 1',mnemonic:raw}]};
  const wallets=[];for(const [i,w] of data.wallets.entries()){wallets.push({...w,id:w.id||randomId(),name:w.name||`Wallet ${i+1}`,accounts:await deriveAccounts(w.mnemonic)});}
  return{version:2,wallets,activeWalletId:wallets.some(w=>w.id===data.activeWalletId)?data.activeWalletId:wallets[0]?.id};
}
async function persistVault(password){const vault=await encryptVault(JSON.stringify(serializableVault()),password);await chrome.storage.local.set({vault});return vault;}
async function verifyPassword(password){const {vault}=await chrome.storage.local.get('vault');return decryptVault(vault,password);}

async function boot(){const stored=await chrome.storage.local.get(['vault','selectedNetwork']);if(stored.selectedNetwork&&NETWORKS[stored.selectedNetwork])state.network=stored.selectedNetwork;state.screen=stored.vault?'unlock':'welcome';render();}
async function setup(create){
  if(state.busy)return;try{state.busy=true;const pw=document.querySelector('#pw').value,pw2=document.querySelector('#pw2').value;if(!pw)throw new Error('Enter a password.');if(pw!==pw2)throw new Error('Passwords do not match.');const mnemonic=create?await createMnemonic():document.querySelector('#mnemonic').value.trim().toLowerCase().replace(/\s+/g,' ');if(!create&&!(await validateMnemonic(mnemonic)))throw new Error('That is not a valid BIP-39 recovery phrase.');const wallet={id:randomId(),name:'Wallet 1',mnemonic,accounts:await deriveAccounts(mnemonic)};state.vaultData={version:2,wallets:[wallet],activeWalletId:wallet.id};await persistVault(pw);state.pendingWallet=create?{mnemonic}:null;state.screen=create?'backup':'home';state.balance=null;state.activity=[];render();if(!create)await refreshAll();}catch(e){setMessage(e.message||'Could not create wallet.');}finally{state.busy=false;}
}
async function finishInitial(){state.pendingWallet=null;state.screen='home';render();await refreshAll();}
async function unlockWallet(){
  if(state.busy)return;try{state.busy=true;const pw=document.querySelector('#pw').value,{vault}=await chrome.storage.local.get('vault');const raw=await decryptVault(vault,pw);const wasLegacy=!raw.trim().startsWith('{');state.vaultData=await hydrateVault(raw);if(wasLegacy)await persistVault(pw);state.balance=null;state.activity=[];state.screen='home';render();await refreshAll();}catch{setMessage('Wrong password or unreadable encrypted vault.');}finally{state.busy=false;}
}
function lockWallet(){state.vaultData=null;state.balance=null;state.activity=[];state.pending=null;state.txResult=null;state.networkMenu=false;state.accountMenu=false;state.secretData=null;state.screen='unlock';render();}
async function rpcCall(net,method,params=[]){const response=await fetch(net.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method,params})});if(!response.ok)throw new Error(`RPC request failed (${response.status}).`);const json=await response.json();if(json.error)throw new Error(json.error.message||`RPC error ${json.error.code}`);return json.result;}
async function fetchConsensusAccount(net,address){const response=await fetch(`${net.nexus}/consensus/accounts/${encodeURIComponent(address)}`,{cache:'no-store'});if(response.status===404)return{available:'0',nonce:0};if(!response.ok)throw new Error(`Nexus request failed (${response.status}).`);return response.json();}
async function refreshBalance(){if(!activeWallet()||state.loadingBalance)return;state.loadingBalance=true;if(state.screen==='home')render();const net=currentNet();try{if(net.kind==='sapphire')state.balance=BigInt(await rpcCall(net,'eth_getBalance',[activeAccounts().eth,'latest']));else{const account=await fetchConsensusAccount(net,activeAccounts().consensus);state.balance=BigInt(account.available||'0');}}catch(e){state.balance=null;console.error(e);}finally{state.loadingBalance=false;if(state.screen==='home')render();}}
function normalizeHash(h){if(!h)return'';return String(h);}
function activityDirection(tx){const a=activeAccounts(),ours=[a?.sapphireNative,a?.eth,a?.consensus].filter(Boolean).map(x=>x.toLowerCase());const sender=String(tx.sender_0||tx.from||tx.signer||tx.signers?.[0]?.address||tx.signers?.[0]||'').toLowerCase();const to=String(tx.to||tx.recipient||'').toLowerCase();if(ours.includes(sender))return'out';if(ours.includes(to))return'in';return'other';}
async function refreshActivity(){
  if(!activeWallet()||state.loadingActivity)return;state.loadingActivity=true;state.activityError=null;if(state.screen==='home')render();const net=currentNet();try{const rel=net.kind==='sapphire'?activeAccounts().sapphireNative:activeAccounts().consensus;const endpoint=net.kind==='sapphire'?`${net.nexus}/sapphire/transactions?rel=${encodeURIComponent(rel)}&limit=8`:`${net.nexus}/consensus/transactions?rel=${encodeURIComponent(rel)}&limit=8`;const r=await fetch(endpoint,{cache:'no-store'});if(!r.ok)throw new Error(`Nexus ${r.status}`);const json=await r.json();const list=json.transactions||json.items||[];state.activity=list.map(tx=>{const hash=normalizeHash(tx.eth_hash||tx.hash||tx.tx_hash);let amount=null;try{if(tx.amount!==undefined&&tx.amount!==null&&String(tx.amount)!=='')amount=BigInt(tx.amount);}catch{}const dt=tx.timestamp?new Date(tx.timestamp):null;return{hash,amount,direction:activityDirection(tx),method:tx.method||tx.type||'',time:dt&&!Number.isNaN(dt.valueOf())?dt.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'',url:explorerTxUrl(net,hash)};}).filter(x=>x.hash);}
  catch(e){state.activity=[];state.activityError=e.message||'Network error';}
  finally{state.loadingActivity=false;if(state.screen==='home')render();}
}
async function refreshAll(){await Promise.allSettled([refreshBalance(),refreshActivity()]);}

function bytesToBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function base64ToBytes(text){const clean=text.replace(/\s+/g,'');if(!clean)return new Uint8Array();const chunks=[];let start=0;for(let i=0;i<clean.length;i++){if(clean[i]!=='=')continue;if(clean[i+1]==='=')i++;const part=clean.slice(start,i+1);if(part){const binary=atob(part);chunks.push(Uint8Array.from(binary,c=>c.charCodeAt(0)));}start=i+1;}if(start<clean.length){let part=clean.slice(start);part+='='.repeat((4-part.length%4)%4);const binary=atob(part);chunks.push(Uint8Array.from(binary,c=>c.charCodeAt(0)));}const total=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(total);let off=0;for(const c of chunks){out.set(c,off);off+=c.length;}return out;}
function grpcFrame(payload){const out=new Uint8Array(5+payload.length);out[0]=0;new DataView(out.buffer).setUint32(1,payload.length,false);out.set(payload,5);return out;}
function parseGrpcFrames(bytes){const dataFrames=[];let grpcStatus=0,grpcMessage='';for(let off=0;off+5<=bytes.length;){const flag=bytes[off],len=new DataView(bytes.buffer,bytes.byteOffset+off+1,4).getUint32(0,false);off+=5;if(off+len>bytes.length)throw new Error('Malformed gRPC-Web response.');const payload=bytes.slice(off,off+len);off+=len;if(flag&0x80){const trailers=new TextDecoder().decode(payload);for(const line of trailers.split(/\r?\n/)){const idx=line.indexOf(':');if(idx<0)continue;const k=line.slice(0,idx).trim().toLowerCase(),v=line.slice(idx+1).trim();if(k==='grpc-status')grpcStatus=Number(v||0);if(k==='grpc-message')grpcMessage=decodeURIComponent(v||'');}}else dataFrames.push(payload);}if(grpcStatus!==0)throw new Error(grpcMessage||`Oasis gRPC error ${grpcStatus}`);return dataFrames;}
async function grpcUnary(base,service,method,request){const payload=request==null?new Uint8Array():cborEncode(request);const response=await fetch(`${base}/oasis-core.${service}/${method}`,{method:'POST',headers:{'content-type':'application/grpc-web-text','accept':'application/grpc-web-text','x-grpc-web':'1','x-user-agent':'grpc-web-javascript/0.1'},body:bytesToBase64(grpcFrame(payload))});if(!response.ok)throw new Error(`Oasis gRPC request failed (${response.status}).`);const ct=response.headers.get('content-type')||'',responseBytes=ct.includes('grpc-web-text')?base64ToBytes(await response.text()):new Uint8Array(await response.arrayBuffer()),frames=parseGrpcFrames(responseBytes);if(!frames.length||frames[0].length===0)return undefined;return cborDecode(frames[0]);}
async function queryRuntimeNonce(net){const response=await grpcUnary(net.grpc,'RuntimeClient','Query',{runtime_id:fromHex(net.runtimeId),round:0xffffffffffffffffn,method:'accounts.Nonce',args:cborEncode({address:decodeOasisAddress(activeAccounts().sapphireNative)})});if(!response?.data)return 0n;const n=cborDecode(response.data);return BigInt(n??0);}

async function prepareSend(){
  if(state.busy)return;try{state.busy=true;setMessage('Preparing transaction…','neutral');const net=currentNet(),to=document.querySelector('#recipient').value.trim(),amountText=document.querySelector('#amount').value.trim();if(!amountText)throw new Error('Enter an amount.');const amount=parseUnits(amountText,net.decimals);if(amount<=0n)throw new Error('Amount must be greater than zero.');if(state.balance==null)await refreshBalance();
    if(net.kind==='sapphire'){
      if(/^oasis1/i.test(to)){
        try{decodeOasisAddress(to);}catch{throw new Error('Enter a valid Sapphire oasis1 address.');}
        if(to.toLowerCase()===activeAccounts().sapphireNative.toLowerCase())throw new Error('Recipient is the same as this wallet.');
        const nonce=await queryRuntimeNonce(net),fee=net.runtimeGas*net.runtimeGasPrice,liveBalance=BigInt(await rpcCall(net,'eth_getBalance',[activeAccounts().eth,'latest']));state.balance=liveBalance;if(amount+fee>liveBalance)throw new Error(`Insufficient ${net.symbol} for amount plus network fee.`);state.pending={network:net.key,mode:'runtime',from:activeAccounts().sapphireNative,to,amount,fee,nonce,gas:net.runtimeGas,feeAmount:fee};
      } else {
        if(!isEvmAddress(to))throw new Error('Enter a valid Sapphire oasis1 or 0x address.');if(to.toLowerCase()===activeAccounts().eth.toLowerCase())throw new Error('Recipient is the same as this wallet.');const[nonceHex,gasPriceHex]=await Promise.all([rpcCall(net,'eth_getTransactionCount',[activeAccounts().eth,'pending']),rpcCall(net,'eth_gasPrice')]);const estimateHex=await rpcCall(net,'eth_estimateGas',[{from:activeAccounts().eth,to,value:toRpcHex(amount)}]);const nonce=BigInt(nonceHex),gasPrice=BigInt(gasPriceHex),estimated=BigInt(estimateHex),gasLimit=estimated<21000n?21000n:(estimated*120n+99n)/100n,fee=gasPrice*gasLimit,liveBalance=BigInt(await rpcCall(net,'eth_getBalance',[activeAccounts().eth,'latest']));state.balance=liveBalance;if(amount+fee>liveBalance)throw new Error(`Insufficient ${net.symbol} for amount plus network fee.`);state.pending={network:net.key,mode:'evm',from:activeAccounts().eth,to,amount,fee,nonce,gasPrice,gasLimit};
      }
    }else{
      try{decodeOasisAddress(to);}catch{throw new Error('Enter a valid Consensus oasis1 address.');}if(to.toLowerCase()===activeAccounts().consensus.toLowerCase())throw new Error('Recipient is the same as this wallet.');const account=await fetchConsensusAccount(net,activeAccounts().consensus),available=BigInt(account.available||'0'),nonce=BigInt(account.nonce||0);state.balance=available;if(amount>available)throw new Error(`Insufficient ${net.symbol}.`);const draft=buildConsensusTransfer({to,amount,nonce,gas:0n}),publicKey=await getConsensusPublicKey(activeMnemonic()),gasResponse=await grpcUnary(net.grpc,'Consensus','EstimateGas',{signer:publicKey,transaction:draft}),gas=BigInt(gasResponse??0);if(gas<=0n)throw new Error('Could not estimate Consensus gas.');const minGasPriceResponse=await grpcUnary(net.grpc,'Consensus','MinGasPrice',undefined),minGasPrice=minGasPriceResponse instanceof Uint8Array?(minGasPriceResponse.length?BigInt('0x'+bytesToHex(minGasPriceResponse)):0n):BigInt(minGasPriceResponse??0),fee=minGasPrice*gas;if(amount+fee>available)throw new Error(`Insufficient ${net.symbol} for amount plus network fee.`);state.pending={network:net.key,mode:'consensus',from:activeAccounts().consensus,to,amount,fee,nonce,gas,feeAmount:fee};
    }
    state.screen='review';render();
  }catch(e){setMessage(e.message||'Could not prepare transaction.');}finally{state.busy=false;}
}
async function broadcastPending(){
  if(state.busy||!state.pending)return;const p=state.pending,net=NETWORKS[p.network];try{state.busy=true;const btn=document.querySelector('#confirmSendBtn');if(btn){btn.disabled=true;btn.textContent='Sending…';}let hash;
    if(p.mode==='evm'){const signed=await signLegacyTransfer({mnemonic:activeMnemonic(),to:p.to,value:p.amount,nonce:p.nonce,gasPrice:p.gasPrice,gasLimit:p.gasLimit,chainId:net.chainId});hash=await rpcCall(net,'eth_sendRawTransaction',[signed.raw]);if(!hash)hash=signed.hash;}
    else if(p.mode==='runtime'){const signed=await signRuntimeTransfer({mnemonic:activeMnemonic(),to:p.to,amount:p.amount,nonce:p.nonce,gas:p.gas,feeAmount:p.feeAmount,runtimeId:net.runtimeId,consensusChainContext:net.chainContext});const response=await grpcUnary(net.grpc,'RuntimeClient','SubmitTx',{runtime_id:fromHex(net.runtimeId),data:signed.encoded});if(response instanceof Uint8Array&&response.length){const result=cborDecode(response);if(result?.fail)throw new Error(result.fail.message||'Sapphire runtime transaction failed.');}hash=signed.txHash;}
    else{const signed=await signConsensusTransfer({mnemonic:activeMnemonic(),to:p.to,amount:p.amount,nonce:p.nonce,gas:p.gas,feeAmount:p.feeAmount||0n,chainContext:net.chainContext});await grpcUnary(net.grpc,'Consensus','SubmitTx',signed.signed);hash=signed.txHash;}
    state.txResult={network:p.network,amount:p.amount,hash};state.pending=null;state.balance=null;state.screen='success';render();
  }catch(e){setMessage(e.message||'Transaction failed to submit.');const btn=document.querySelector('#confirmSendBtn');if(btn){btn.disabled=false;btn.textContent='Confirm & Send';}}finally{state.busy=false;}
}
async function selectNetwork(key){if(!NETWORKS[key]||key===state.network){state.networkMenu=false;render();return;}state.network=key;state.networkMenu=false;state.balance=null;state.activity=[];state.pending=null;await chrome.storage.local.set({selectedNetwork:key});render();if(state.screen==='home')await refreshAll();}
async function selectWallet(id){if(!state.vaultData?.wallets?.some(w=>w.id===id))return;state.vaultData.activeWalletId=id;state.accountMenu=false;state.balance=null;state.activity=[];state.pending=null;render();await refreshAll();}
async function addImportedWallet(){
  if(state.busy)return;try{state.busy=true;const name=(document.querySelector('#walletName').value.trim()||`Wallet ${state.vaultData.wallets.length+1}`),mnemonic=document.querySelector('#mnemonic').value.trim().toLowerCase().replace(/\s+/g,' '),pw=document.querySelector('#currentPw').value;if(!(await validateMnemonic(mnemonic)))throw new Error('That recovery phrase is not valid.');await verifyPassword(pw);const wallet={id:randomId(),name,mnemonic,accounts:await deriveAccounts(mnemonic)};state.vaultData.wallets.push(wallet);state.vaultData.activeWalletId=wallet.id;await persistVault(pw);state.balance=null;state.activity=[];state.screen='home';render();await refreshAll();}catch(e){setMessage(e.message||'Could not import wallet.');}finally{state.busy=false;}
}
async function createAdditionalWallet(){state.pendingWallet={mnemonic:await createMnemonic()};state.screen='addBackup';render();}
async function saveAdditionalWallet(){
  if(state.busy)return;try{state.busy=true;const pw=document.querySelector('#currentPw').value,name=document.querySelector('#walletName').value.trim()||`Wallet ${state.vaultData.wallets.length+1}`;await verifyPassword(pw);const mnemonic=state.pendingWallet.mnemonic,wallet={id:randomId(),name,mnemonic,accounts:await deriveAccounts(mnemonic)};state.vaultData.wallets.push(wallet);state.vaultData.activeWalletId=wallet.id;await persistVault(pw);state.pendingWallet=null;state.balance=null;state.activity=[];state.screen='home';render();await refreshAll();}catch(e){setMessage(e.message||'Could not add wallet.');}finally{state.busy=false;}
}
async function revealSensitive(){
  if(state.busy)return;try{state.busy=true;const pw=document.querySelector('#verifyPw').value;await verifyPassword(pw);state.secretData=state.secretType==='keys'?await exportWalletSecrets(activeMnemonic()):null;state.screen='secretDisplay';render();}catch{setMessage('Wrong password.');}finally{state.busy=false;}
}
async function changePasswordSave(){
  if(state.busy)return;try{state.busy=true;const oldPw=document.querySelector('#currentPw').value,newPw=document.querySelector('#newPw').value,newPw2=document.querySelector('#newPw2').value;if(!newPw)throw new Error('Enter a new password.');if(newPw!==newPw2)throw new Error('New passwords do not match.');await verifyPassword(oldPw);await persistVault(newPw);setMessage('Password changed successfully.','success');document.querySelector('#currentPw').value='';document.querySelector('#newPw').value='';document.querySelector('#newPw2').value='';}catch(e){setMessage(e.message||'Could not change password.');}finally{state.busy=false;}
}

function bind(){
  document.querySelector('#createBtn')?.addEventListener('click',()=>{state.screen='create';render();});document.querySelector('#importBtn')?.addEventListener('click',()=>{state.screen='import';render();});document.querySelector('#continueBtn')?.addEventListener('click',()=>setup(state.screen==='create'));document.querySelector('#savedCheck')?.addEventListener('change',(e)=>{const b=document.querySelector(state.screen==='backup'?'#finishBtn':'#saveAnotherBtn');if(b)b.disabled=!e.target.checked;});document.querySelector('#finishBtn')?.addEventListener('click',finishInitial);document.querySelector('#unlockBtn')?.addEventListener('click',unlockWallet);document.querySelector('#pw')?.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&state.screen==='unlock')unlockWallet();});
  document.querySelector('#resetBtn')?.addEventListener('click',async()=>{if(confirm('Remove all encrypted wallets from this browser? Make sure every recovery phrase is backed up first.')){await chrome.storage.local.remove(['vault']);state.vaultData=null;state.screen='welcome';render();}});
  document.querySelector('#settingsBtn')?.addEventListener('click',()=>{state.screen='settings';render();});document.querySelector('#lockSettingsBtn')?.addEventListener('click',lockWallet);
  document.querySelector('#networkBtn')?.addEventListener('click',(e)=>{e.stopPropagation();state.networkMenu=!state.networkMenu;render();});document.querySelector('#networkOverlay')?.addEventListener('click',(e)=>{if(e.target.id==='networkOverlay'){state.networkMenu=false;render();}});document.querySelectorAll('[data-network]').forEach(el=>el.addEventListener('click',()=>selectNetwork(el.dataset.network)));
  document.querySelector('#accountBtn')?.addEventListener('click',()=>{state.accountMenu=!state.accountMenu;render();});document.querySelector('#accountOverlay')?.addEventListener('click',(e)=>{if(e.target.id==='accountOverlay'){state.accountMenu=false;render();}});document.querySelectorAll('[data-wallet-id]').forEach(el=>el.addEventListener('click',()=>selectWallet(el.dataset.walletId)));document.querySelector('#addWalletBtn')?.addEventListener('click',()=>{state.accountMenu=false;state.screen='addWallet';render();});document.querySelector('#addWalletFromSheet')?.addEventListener('click',()=>{state.accountMenu=false;state.screen='addWallet';render();});
  document.querySelector('#sendBtn')?.addEventListener('click',()=>{state.screen='send';render();});document.querySelector('#receiveBtn')?.addEventListener('click',()=>{state.screen='receive';render();});document.querySelector('#refreshBtn')?.addEventListener('click',refreshAll);document.querySelector('#activityRefresh')?.addEventListener('click',refreshActivity);document.querySelector('#activityRetry')?.addEventListener('click',refreshActivity);document.querySelector('#reviewBtn')?.addEventListener('click',prepareSend);
  document.querySelector('#maxBtn')?.addEventListener('click',async()=>{const net=currentNet();if(state.balance==null)await refreshBalance();let max=state.balance||0n;if(net.kind==='sapphire'&&max>0n){let reserve=net.runtimeGas*net.runtimeGasPrice;try{const gasPrice=BigInt(await rpcCall(net,'eth_gasPrice'));const evmReserve=gasPrice*30000n;if(evmReserve>reserve)reserve=evmReserve;}catch{}max=max>reserve?max-reserve:0n;}document.querySelector('#amount').value=formatUnits(max,net.decimals,net.decimals);});
  document.querySelector('#mainnetConfirm')?.addEventListener('change',(e)=>{document.querySelector('#confirmSendBtn').disabled=!e.target.checked;});document.querySelector('#confirmSendBtn')?.addEventListener('click',broadcastPending);document.querySelector('#editSendBtn')?.addEventListener('click',()=>{state.screen='send';render();});document.querySelector('#doneBtn')?.addEventListener('click',async()=>{state.txResult=null;state.screen='home';render();await refreshAll();});
  document.querySelector('#addWalletSettings')?.addEventListener('click',()=>{state.screen='addWallet';render();});document.querySelector('#createAnotherBtn')?.addEventListener('click',createAdditionalWallet);document.querySelector('#importAnotherBtn')?.addEventListener('click',()=>{state.screen='addImport';render();});document.querySelector('#importAnotherConfirm')?.addEventListener('click',addImportedWallet);document.querySelector('#saveAnotherBtn')?.addEventListener('click',saveAdditionalWallet);
  document.querySelectorAll('[data-secret]').forEach(el=>el.addEventListener('click',()=>{state.secretType=el.dataset.secret;state.previousScreen='settings';state.screen='verifySecret';render();}));document.querySelector('#revealBtn')?.addEventListener('click',revealSensitive);document.querySelector('#changePasswordBtn')?.addEventListener('click',()=>{state.screen='changePassword';render();});document.querySelector('#savePasswordBtn')?.addEventListener('click',changePasswordSave);
  document.querySelector('#backBtn')?.addEventListener('click',()=>{if(['create','import'].includes(state.screen))state.screen='welcome';else if(state.screen==='backup')state.screen='create';else if(state.screen==='review')state.screen='send';else if(['settings','receive','send'].includes(state.screen))state.screen='home';else if(['addWallet'].includes(state.screen))state.screen='settings';else if(['addImport','addBackup'].includes(state.screen))state.screen='addWallet';else if(['verifySecret','changePassword'].includes(state.screen))state.screen='settings';else if(state.screen==='secretDisplay'){state.secretData=null;state.screen='settings';}else state.screen='home';state.networkMenu=false;state.accountMenu=false;render();});
  document.querySelectorAll('.copy').forEach(el=>el.addEventListener('click',async(e)=>{e.preventDefault();e.stopPropagation();const value=el.dataset.copy;if(!value)return;await navigator.clipboard.writeText(value);el.classList.add('copied');setTimeout(()=>el.classList.remove('copied'),900);}));
}

boot();
