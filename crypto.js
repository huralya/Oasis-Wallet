const te = new TextEncoder();
const BIP39_URL='https://raw.githubusercontent.com/bitcoin/bips/master/bip-0039/english.txt';
const BIP39_SHA256='2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
const SECP_P=0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N=0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX=0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY=0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const MASK64=(1n<<64n)-1n;
const K512=[
0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0x0fc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x06ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x06f067aa72176fban,0x0a637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];
export const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
const cat=(...a)=>{let n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n),p=0;for(const x of a){o.set(x,p);p+=x.length}return o};
const u32=i=>new Uint8Array([(i>>>24)&255,(i>>>16)&255,(i>>>8)&255,i&255]);
const bytesToBig=b=>BigInt('0x'+hex(b));
const bigToBytes=(n,l=32)=>{let h=n.toString(16).padStart(l*2,'0');return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)))};
const b64uToBytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function hmac(name,key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:name},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data))}
async function sha256(data){return new Uint8Array(await crypto.subtle.digest('SHA-256',data))}
async function sha512(data){return new Uint8Array(await crypto.subtle.digest('SHA-512',data))}
function mod(a,m){const r=a%m;return r>=0n?r:r+m} function inv(a,m){let lm=1n,hm=0n,low=mod(a,m),high=m;while(low>1n){let r=high/low;[lm,hm]=[hm-lm*r,lm];[low,high]=[high-low*r,low]}return mod(lm,m)}
function add(P,Q){if(!P)return Q;if(!Q)return P;if(P.x===Q.x&&P.y!==Q.y)return null;let m=P.x===Q.x?mod((3n*P.x*P.x)*inv(2n*P.y,SECP_P),SECP_P):mod((Q.y-P.y)*inv(Q.x-P.x,SECP_P),SECP_P);let x=mod(m*m-P.x-Q.x,SECP_P),y=mod(m*(P.x-x)-P.y,SECP_P);return{x,y}}
function mul(k,P={x:GX,y:GY}){let n=mod(k,SECP_N),Q=null,A=P;while(n){if(n&1n)Q=add(Q,A);A=add(A,A);n>>=1n}return Q}
function pub(priv,compressed=true){const P=mul(priv);if(compressed)return cat(new Uint8Array([Number(P.y&1n)?3:2]),bigToBytes(P.x));return cat(new Uint8Array([4]),bigToBytes(P.x),bigToBytes(P.y))}
async function bip32(seed,path){let I=await hmac('SHA-512',te.encode('Bitcoin seed'),seed),k=bytesToBig(I.slice(0,32)),c=I.slice(32);for(const idx of path){let hard=idx>=0x80000000;let data=hard?cat(new Uint8Array([0]),bigToBytes(k),u32(idx)):cat(pub(k,true),u32(idx));I=await hmac('SHA-512',c,data);k=mod(bytesToBig(I.slice(0,32))+k,SECP_N);if(k===0n)throw new Error('Invalid derived key');c=I.slice(32)}return k}
function rol64(x,n){n=BigInt(n);return ((x<<n)|(x>>(64n-n)))&MASK64}
export function keccak256(bytes){const RC=[1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];const R=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];let rate=136,m=[...bytes,1];while(m.length%rate!==rate-1)m.push(0);m.push(0x80);let s=Array(25).fill(0n);for(let off=0;off<m.length;off+=rate){for(let i=0;i<rate/8;i++){let v=0n;for(let j=0;j<8;j++)v|=BigInt(m[off+i*8+j])<<(8n*BigInt(j));s[i]^=v}for(const rc of RC){let C=Array(5),D=Array(5);for(let x=0;x<5;x++)C[x]=s[x]^s[x+5]^s[x+10]^s[x+15]^s[x+20];for(let x=0;x<5;x++)D[x]=C[(x+4)%5]^rol64(C[(x+1)%5],1);for(let x=0;x<5;x++)for(let y=0;y<5;y++)s[x+5*y]^=D[x];let B=Array(25);for(let x=0;x<5;x++)for(let y=0;y<5;y++)B[y+5*((2*x+3*y)%5)]=rol64(s[x+5*y],R[x][y]);for(let x=0;x<5;x++)for(let y=0;y<5;y++)s[x+5*y]=B[x+5*y]^((~B[(x+1)%5+5*y])&B[(x+2)%5+5*y]);s[0]^=rc}}let out=new Uint8Array(32);for(let i=0;i<4;i++){let v=s[i];for(let j=0;j<8;j++)out[i*8+j]=Number((v>>(8n*BigInt(j)))&255n)}return out}
function sha512_256(msg){let h=[0x22312194fc2bf72cn,0x9f555fa3c84c64c2n,0x2393b86b6f53b151n,0x963877195940eabdn,0x96283ee2a88effe3n,0xbe5e1e2553863992n,0x2b0199fc2c85b8aan,0x0eb72ddc81c52ca2n];let m=[...msg,0x80],bit=BigInt(msg.length)*8n;while((m.length+16)%128)m.push(0);for(let i=0;i<8;i++)m.push(0);for(let i=7;i>=0;i--)m.push(Number((bit>>(BigInt(i)*8n))&255n));for(let off=0;off<m.length;off+=128){let w=Array(80);for(let i=0;i<16;i++){let v=0n;for(let j=0;j<8;j++)v=(v<<8n)|BigInt(m[off+i*8+j]);w[i]=v}for(let i=16;i<80;i++){let a=w[i-15],b=w[i-2],s0=(rol64(a,63)^rol64(a,56)^(a>>7n)),s1=(rol64(b,45)^rol64(b,3)^(b>>6n));w[i]=(w[i-16]+s0+w[i-7]+s1)&MASK64}let[a,b,c,d,e,f,g,hh]=h;for(let i=0;i<80;i++){let S1=rol64(e,50)^rol64(e,46)^rol64(e,23),ch=(e&f)^((~e)&g),t1=(hh+S1+ch+K512[i]+w[i])&MASK64,S0=rol64(a,36)^rol64(a,30)^rol64(a,25),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)&MASK64;hh=g;g=f;f=e;e=(d+t1)&MASK64;d=c;c=b;b=a;a=(t1+t2)&MASK64}h=h.map((x,i)=>(x+[a,b,c,d,e,f,g,hh][i])&MASK64)}let out=new Uint8Array(32);for(let i=0;i<4;i++)out.set(bigToBytes(h[i],8),i*8);return out}
const BECH='qpzry9x8gf2tvdw0s3jn54khce6mua7l';function polymod(v){let chk=1;const G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];for(const x of v){let top=chk>>>25;chk=((chk&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=G[i]}return chk>>>0}function hrpExpand(s){return [...s].map(c=>c.charCodeAt(0)>>5).concat([0],[...s].map(c=>c.charCodeAt(0)&31))}function convertBits(data,from,to,pad=true){let acc=0,bits=0,ret=[],maxv=(1<<to)-1;for(const v of data){acc=(acc<<from)|v;bits+=from;while(bits>=to){bits-=to;ret.push((acc>>bits)&maxv)}}if(pad&&bits)ret.push((acc<<(to-bits))&maxv);return ret}function bech32(hrp,data){let d=convertBits(data,8,5,true),p=hrpExpand(hrp).concat(d).concat([0,0,0,0,0,0]),pm=polymod(p)^1,cs=[];for(let i=0;i<6;i++)cs.push((pm>>(5*(5-i)))&31);return hrp+'1'+d.concat(cs).map(x=>BECH[x]).join('')}
function oasisAddress(context,data){const ver=new Uint8Array([0]),hash=sha512_256(cat(te.encode(context),ver,data));return bech32('oasis',cat(ver,hash.slice(0,20)))}
export async function loadWordlist(){
  let text='';
  try{
    if(globalThis.chrome?.storage?.local){const cached=await chrome.storage.local.get('bip39English');text=cached.bip39English||''}
  }catch{}
  async function verify(raw){const normalized=raw.endsWith('\n')?raw:raw+'\n',digest=hex(await sha256(te.encode(normalized)));if(digest!==BIP39_SHA256)throw new Error('BIP-39 wordlist integrity check failed');const list=normalized.trim().split(/\s+/);if(list.length!==2048||new Set(list).size!==2048||list[0]!=='abandon'||list[2047]!=='zoo')throw new Error('BIP-39 wordlist integrity check failed');return list}
  if(text){try{return await verify(text)}catch{}}
  const r=await fetch(BIP39_URL,{cache:'no-store'});if(!r.ok)throw new Error('Could not load the BIP-39 wordlist. Connect to the internet once to initialize mnemonic support.');text=await r.text();const list=await verify(text);try{if(globalThis.chrome?.storage?.local)await chrome.storage.local.set({bip39English:text})}catch{}return list;
}
export async function createMnemonic(){const wl=await loadWordlist(),ent=crypto.getRandomValues(new Uint8Array(16)),hash=await sha256(ent),bits=[...ent].map(b=>b.toString(2).padStart(8,'0')).join('')+hash[0].toString(2).padStart(8,'0').slice(0,4);let words=[];for(let i=0;i<12;i++)words.push(wl[parseInt(bits.slice(i*11,i*11+11),2)]);return words.join(' ')}
export async function validateMnemonic(m){const words=m.trim().toLowerCase().split(/\s+/);if(![12,15,18,21,24].includes(words.length))return false;const wl=await loadWordlist(),idx=words.map(w=>wl.indexOf(w));if(idx.some(i=>i<0))return false;const bits=idx.map(i=>i.toString(2).padStart(11,'0')).join(''),entBits=Math.floor(bits.length*32/33),cs=bits.length-entBits,eb=bits.slice(0,entBits),cb=bits.slice(entBits),ent=new Uint8Array(entBits/8);for(let i=0;i<ent.length;i++)ent[i]=parseInt(eb.slice(i*8,i*8+8),2);const h=await sha256(ent),hb=[...h].map(b=>b.toString(2).padStart(8,'0')).join('');return cb===hb.slice(0,cs)}
export async function mnemonicSeed(m){const key=await crypto.subtle.importKey('raw',te.encode(m.normalize('NFKD')),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-512',salt:te.encode('mnemonic'),iterations:2048},key,512))}
export async function deriveAccounts(m){const seed=await mnemonicSeed(m);const k=await bip32(seed,[0x8000002c,0x8000003c,0x80000000,0,0]),unp=pub(k,false),eth=keccak256(unp.slice(1)).slice(12),ethHex='0x'+hex(eth),sapNative=oasisAddress('oasis-runtime-sdk/address: secp256k1eth',eth);let I=await hmac('SHA-512',te.encode('ed25519 seed'),seed),sk=I.slice(0,32),cc=I.slice(32);for(const n of [44,474,0]){I=await hmac('SHA-512',cc,cat(new Uint8Array([0]),sk,u32(0x80000000+n)));sk=I.slice(0,32);cc=I.slice(32)}const prefix=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);const key=await crypto.subtle.importKey('pkcs8',cat(prefix,sk),{name:'Ed25519'},true,['sign']);const jwk=await crypto.subtle.exportKey('jwk',key),edpk=b64uToBytes(jwk.x);const consensus=oasisAddress('oasis-core/address: staking',edpk);return{eth:ethHex,sapphireNative:sapNative,consensus}}
export async function encryptVault(mnemonic,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),base=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveKey']),key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},base,{name:'AES-GCM',length:256},false,['encrypt']),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('rose-wallet-v1')},key,te.encode(mnemonic)));return{v:1,kdf:'PBKDF2-SHA256',iterations:600000,salt:hex(salt),iv:hex(iv),ciphertext:hex(ct)}}
function unhex(h){return new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)))}
export async function decryptVault(v,password){const base=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveKey']),key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:unhex(v.salt),iterations:v.iterations},base,{name:'AES-GCM',length:256},false,['decrypt']);const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(v.iv),additionalData:te.encode('rose-wallet-v1')},key,unhex(v.ciphertext));return new TextDecoder().decode(pt)}

// --- Transaction signing helpers (v0.2) ---
function bigintBytes(n){
  if(n===0n)return new Uint8Array();
  let h=n.toString(16); if(h.length%2)h='0'+h;
  return unhex(h);
}
function ensureBytes(v){
  if(v instanceof Uint8Array)return v;
  if(typeof v==='bigint')return bigintBytes(v);
  if(typeof v==='number')return bigintBytes(BigInt(v));
  if(typeof v==='string'&&/^0x[0-9a-fA-F]*$/.test(v))return v.length===2?new Uint8Array():unhex(v.slice(2));
  throw new Error('Unsupported byte value');
}
function rlpBytes(bytes){
  const b=ensureBytes(bytes);
  if(b.length===1&&b[0]<0x80)return b;
  if(b.length<=55)return cat(new Uint8Array([0x80+b.length]),b);
  const len=bigintBytes(BigInt(b.length));
  return cat(new Uint8Array([0xb7+len.length]),len,b);
}
function rlpList(items){
  const payload=cat(...items.map(rlpEncode));
  if(payload.length<=55)return cat(new Uint8Array([0xc0+payload.length]),payload);
  const len=bigintBytes(BigInt(payload.length));
  return cat(new Uint8Array([0xf7+len.length]),len,payload);
}
function rlpEncode(v){return Array.isArray(v)?rlpList(v):rlpBytes(v)}

async function rfc6979(priv,hash,skip=0){
  const x=bigToBytes(priv,32),h=bigToBytes(mod(bytesToBig(hash),SECP_N),32);
  let V=new Uint8Array(32).fill(1),K=new Uint8Array(32);
  K=await hmac('SHA-256',K,cat(V,new Uint8Array([0]),x,h));
  V=await hmac('SHA-256',K,V);
  K=await hmac('SHA-256',K,cat(V,new Uint8Array([1]),x,h));
  V=await hmac('SHA-256',K,V);
  let seen=0;
  while(true){
    V=await hmac('SHA-256',K,V);
    const k=bytesToBig(V);
    if(k>0n&&k<SECP_N){if(seen++>=skip)return k}
    K=await hmac('SHA-256',K,cat(V,new Uint8Array([0])));
    V=await hmac('SHA-256',K,V);
  }
}
async function ecdsaSign(priv,hash){
  const z=mod(bytesToBig(hash),SECP_N);
  for(let skip=0;skip<16;skip++){
    const k=await rfc6979(priv,hash,skip),R=mul(k);
    if(!R||R.x>=SECP_N)continue;
    const r=R.x;
    if(r===0n)continue;
    let s=mod(inv(k,SECP_N)*(z+r*priv),SECP_N);
    if(s===0n)continue;
    let recovery=Number(R.y&1n);
    if(s>SECP_N/2n){s=SECP_N-s;recovery^=1}
    return{r,s,recovery};
  }
  throw new Error('Could not produce ECDSA signature');
}

export function parseUnits(value,decimals){
  const s=String(value).trim();
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s))throw new Error('Enter a valid amount.');
  let [whole,frac='']=s.split('.');
  if(frac.length>decimals)throw new Error(`Amount supports up to ${decimals} decimal places.`);
  frac=frac.padEnd(decimals,'0');
  return BigInt(whole)*10n**BigInt(decimals)+BigInt(frac||'0');
}
export function formatUnits(value,decimals,maxFraction=6){
  const n=BigInt(value),base=10n**BigInt(decimals),whole=n/base,rem=(n%base).toString().padStart(decimals,'0');
  let frac=rem.slice(0,maxFraction).replace(/0+$/,'');
  return frac?`${whole}.${frac}`:`${whole}`;
}
export function isEvmAddress(a){return /^0x[0-9a-fA-F]{40}$/.test(String(a||''))}

async function deriveConsensusMaterial(seed){
  let I=await hmac('SHA-512',te.encode('ed25519 seed'),seed),sk=I.slice(0,32),cc=I.slice(32);
  for(const n of [44,474,0]){I=await hmac('SHA-512',cc,cat(new Uint8Array([0]),sk,u32(0x80000000+n)));sk=I.slice(0,32);cc=I.slice(32)}
  const prefix=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const key=await crypto.subtle.importKey('pkcs8',cat(prefix,sk),{name:'Ed25519'},true,['sign']);
  const jwk=await crypto.subtle.exportKey('jwk',key),publicKey=b64uToBytes(jwk.x);
  return{seed:sk,key,publicKey};
}
export async function deriveSigningMaterial(mnemonic){
  const seed=await mnemonicSeed(mnemonic);
  const ethPrivate=await bip32(seed,[0x8000002c,0x8000003c,0x80000000,0,0]);
  const consensus=await deriveConsensusMaterial(seed);
  return{ethPrivate,consensus};
}

export async function signLegacyTransfer({mnemonic,to,value,nonce,gasPrice,gasLimit,chainId}){
  if(!isEvmAddress(to))throw new Error('Sapphire sends require a 0x address.');
  const {ethPrivate}=await deriveSigningMaterial(mnemonic);
  const unsigned=[BigInt(nonce),BigInt(gasPrice),BigInt(gasLimit),unhex(to.slice(2)),BigInt(value),new Uint8Array(),BigInt(chainId),0n,0n];
  const signingData=rlpEncode(unsigned),hash=keccak256(signingData);
  const sig=await ecdsaSign(ethPrivate,hash);
  const v=BigInt(chainId)*2n+35n+BigInt(sig.recovery);
  const signed=rlpEncode([BigInt(nonce),BigInt(gasPrice),BigInt(gasLimit),unhex(to.slice(2)),BigInt(value),new Uint8Array(),v,sig.r,sig.s]);
  return{raw:'0x'+hex(signed),hash:'0x'+hex(keccak256(signed)),v,r:sig.r,s:sig.s};
}

function cborHead(major,n){
  n=BigInt(n);
  if(n<24n)return new Uint8Array([(major<<5)|Number(n)]);
  if(n<=0xffn)return new Uint8Array([(major<<5)|24,Number(n)]);
  if(n<=0xffffn)return new Uint8Array([(major<<5)|25,Number((n>>8n)&255n),Number(n&255n)]);
  if(n<=0xffffffffn)return new Uint8Array([(major<<5)|26,Number((n>>24n)&255n),Number((n>>16n)&255n),Number((n>>8n)&255n),Number(n&255n)]);
  const out=new Uint8Array(9);out[0]=(major<<5)|27;for(let i=0;i<8;i++)out[8-i]=Number((n>>(8n*BigInt(i)))&255n);return out;
}
function cmpBytes(a,b){if(a.length!==b.length)return a.length-b.length;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0}
export function cborEncode(v){
  if(v===null)return new Uint8Array([0xf6]);
  if(v===false)return new Uint8Array([0xf4]);
  if(v===true)return new Uint8Array([0xf5]);
  if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)throw new Error('Unsupported CBOR number');v=BigInt(v)}
  if(typeof v==='bigint'){if(v<0n)throw new Error('Negative CBOR integers are not used here');return cborHead(0,v)}
  if(v instanceof Uint8Array)return cat(cborHead(2,v.length),v);
  if(typeof v==='string'){const b=te.encode(v);return cat(cborHead(3,b.length),b)}
  if(Array.isArray(v))return cat(cborHead(4,v.length),...v.map(cborEncode));
  if(typeof v==='object'){
    const entries=Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[cborEncode(k),cborEncode(x)]).sort((a,b)=>cmpBytes(a[0],b[0]));
    return cat(cborHead(5,entries.length),...entries.flat());
  }
  throw new Error('Unsupported CBOR type');
}
function cborReadLen(bytes,off,ai){
  if(ai<24)return[BigInt(ai),off];
  if(ai===24)return[BigInt(bytes[off]),off+1];
  if(ai===25)return[BigInt((bytes[off]<<8)|bytes[off+1]),off+2];
  if(ai===26)return[(BigInt(bytes[off])<<24n)|(BigInt(bytes[off+1])<<16n)|(BigInt(bytes[off+2])<<8n)|BigInt(bytes[off+3]),off+4];
  if(ai===27){let n=0n;for(let i=0;i<8;i++)n=(n<<8n)|BigInt(bytes[off+i]);return[n,off+8]}
  throw new Error('Unsupported CBOR length');
}
export function cborDecode(bytes){
  const td=new TextDecoder();
  function read(off){
    const ib=bytes[off++],major=ib>>5,ai=ib&31;
    if(major===7){if(ai===20)return[false,off];if(ai===21)return[true,off];if(ai===22)return[null,off];throw new Error('Unsupported CBOR simple value')}
    let[len,p]=cborReadLen(bytes,off,ai);off=p;
    if(major===0)return[len<=BigInt(Number.MAX_SAFE_INTEGER)?Number(len):len,off];
    if(major===2){const n=Number(len),v=bytes.slice(off,off+n);return[v,off+n]}
    if(major===3){const n=Number(len),v=td.decode(bytes.slice(off,off+n));return[v,off+n]}
    if(major===4){const arr=[];for(let i=0;i<Number(len);i++){let[v,n]=read(off);arr.push(v);off=n}return[arr,off]}
    if(major===5){const obj={};for(let i=0;i<Number(len);i++){let[k,n1]=read(off);off=n1;let[v,n2]=read(off);off=n2;obj[String(k)]=v}return[obj,off]}
    throw new Error('Unsupported CBOR major type');
  }
  return read(0)[0];
}
function decodeBech32(addr){
  const s=String(addr).toLowerCase();if(!s.startsWith('oasis1'))throw new Error('Invalid Oasis address.');
  const pos=s.lastIndexOf('1'),hrp=s.slice(0,pos),chars=s.slice(pos+1),vals=[];
  for(const c of chars){const i=BECH.indexOf(c);if(i<0)throw new Error('Invalid Oasis address.');vals.push(i)}
  if(polymod(hrpExpand(hrp).concat(vals))!==1)throw new Error('Invalid Oasis address checksum.');
  const data=convertBits(vals.slice(0,-6),5,8,false);if(data.length!==21)throw new Error('Invalid Oasis address length.');
  return new Uint8Array(data);
}
export function buildConsensusTransfer({to,amount,nonce,gas=0n,feeAmount=0n}){
  return{nonce:BigInt(nonce),fee:{amount:bigintBytes(BigInt(feeAmount)),gas:BigInt(gas)},method:'staking.Transfer',body:{to:decodeBech32(to),amount:bigintBytes(BigInt(amount))}};
}
export async function getConsensusPublicKey(mnemonic){
  const seed=await mnemonicSeed(mnemonic),m=await deriveConsensusMaterial(seed);return m.publicKey;
}
export async function signConsensusTransfer({mnemonic,to,amount,nonce,gas,feeAmount=0n,chainContext}){
  const seed=await mnemonicSeed(mnemonic),m=await deriveConsensusMaterial(seed),tx=buildConsensusTransfer({to,amount,nonce,gas,feeAmount});
  const raw=cborEncode(tx),context=`oasis-core/consensus: tx for chain ${chainContext}`,signerMessage=sha512_256(cat(te.encode(context),raw));
  const signature=new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},m.key,signerMessage));
  const signed={untrusted_raw_value:raw,signature:{public_key:m.publicKey,signature}};
  const encoded=cborEncode(signed),txHash=hex(sha512_256(encoded));
  return{signed,encoded,txHash};
}

// --- Native Sapphire runtime helpers (v0.3) ---
export function decodeOasisAddress(address){return decodeBech32(address)}
export function fromHex(value){const h=String(value||'').replace(/^0x/,'');if(!h||h.length%2||!/^[0-9a-fA-F]+$/.test(h))throw new Error('Invalid hex value');return unhex(h)}
function derInt(n){let b=bigToBytes(n,32);let i=0;while(i<b.length-1&&b[i]===0)i++;b=b.slice(i);if(b[0]&0x80)b=cat(new Uint8Array([0]),b);return cat(new Uint8Array([0x02,b.length]),b)}
function derSignature(r,s){const rb=derInt(r),sb=derInt(s),body=cat(rb,sb);return cat(new Uint8Array([0x30,body.length]),body)}
export async function exportWalletSecrets(mnemonic){
  const {ethPrivate,consensus}=await deriveSigningMaterial(mnemonic);
  return{
    sapphirePrivateKey:'0x'+hex(bigToBytes(ethPrivate,32)),
    consensusPrivateSeed:'0x'+hex(consensus.seed),
    consensusPublicKey:'0x'+hex(consensus.publicKey),
  };
}
export async function signRuntimeTransfer({mnemonic,to,amount,nonce,gas=70000n,feeAmount=7000000n,runtimeId,consensusChainContext}){
  const destination=decodeBech32(to);
  const {ethPrivate}=await deriveSigningMaterial(mnemonic);
  const publicKey=pub(ethPrivate,true);
  const tx={
    v:1,
    call:{method:'accounts.Transfer',body:{to:destination,amount:[bigintBytes(BigInt(amount)),new Uint8Array()]}},
    ai:{
      si:[{address_spec:{signature:{secp256k1eth:publicKey}},nonce:BigInt(nonce)}],
      fee:{amount:[bigintBytes(BigInt(feeAmount)),new Uint8Array()],gas:BigInt(gas),consensus_messages:0},
    },
  };
  const raw=cborEncode(tx);
  const runtimeID=fromHex(runtimeId);
  const derivedChainContext=hex(sha512_256(cat(runtimeID,te.encode(consensusChainContext))));
  const context=`oasis-runtime-sdk/tx: v0 for chain ${derivedChainContext}`;
  const signerMessage=sha512_256(cat(te.encode(context),raw));
  const sig=await ecdsaSign(ethPrivate,signerMessage);
  const signature=derSignature(sig.r,sig.s);
  const unverified=[raw,[{signature}]];
  const encoded=cborEncode(unverified);
  const txHash=hex(sha512_256(encoded));
  return{tx,raw,unverified,encoded,txHash,publicKey,derivedChainContext};
}
