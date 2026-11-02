'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const {HubError}=require('./validation');
const COOKIE='__Host-reduct_hub';
function configuration(env=process.env){
  const url=env.KV_REST_API_URL||env.UPSTASH_REDIS_REST_URL;
  const token=env.KV_REST_API_TOKEN||env.UPSTASH_REDIS_REST_TOKEN;
  const hash=env.PROJECT_HUB_PASSWORD_HASH||'';
  const secret=env.PROJECT_HUB_SESSION_SECRET||'';
  const dataKey=env.PROJECT_HUB_DATA_KEY||'';
  const match=/^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]{22,86})\$([A-Za-z0-9_-]{43})$/.exec(hash);
  let parsed;
  try{parsed=new URL(url);}catch{}
  if(!parsed||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!token||!match||Buffer.byteLength(secret)<32||!/^[A-Za-z0-9_-]{43}$/.test(dataKey))throw new HubError('not_configured','공용 저장소와 로그인 설정이 아직 완료되지 않았습니다. 관리자에게 문의하세요.',503);
  const key=Buffer.from(dataKey,'base64url');
  if(key.length!==32)throw new HubError('not_configured','데이터 암호화 설정이 올바르지 않습니다.',503);
  const namespace=env.PROJECT_HUB_NAMESPACE||'reduct:project-hub';
  if(!/^[A-Za-z0-9:_-]{1,100}$/.test(namespace))throw new HubError('not_configured','저장소 설정이 올바르지 않습니다.',503);
  return {url:parsed.href.replace(/\/$/,''),token,hash,secret,key,namespace,salt:Buffer.from(match[1],'base64url'),derived:Buffer.from(match[2],'base64url')};
}
function encrypt(value,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({version:1,algorithm:'aes-256-gcm',iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:ciphertext.toString('base64url')});}
function decrypt(raw,key){try{const e=typeof raw==='string'?JSON.parse(raw):raw;if(e.version!==1||e.algorithm!=='aes-256-gcm'||typeof e.iv!=='string'||typeof e.tag!=='string'||typeof e.ciphertext!=='string')throw new Error();const iv=Buffer.from(e.iv,'base64url'),tag=Buffer.from(e.tag,'base64url');if(iv.length!==12||tag.length!==16)throw new Error();const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'base64url')),decipher.final()]).toString('utf8'));}catch{throw new HubError('corrupt_data','공용 데이터 또는 암호화 키를 확인할 수 없습니다. 원본을 유지했습니다. 관리자에게 문의하세요.',503);}}
async function verifyPassword(password,config){if(typeof password!=='string'||password.length>256)return false;const result=await scrypt(password,config.salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});return result.length===config.derived.length&&crypto.timingSafeEqual(result,config.derived);}
function sign(value,config){return crypto.createHmac('sha256',config.secret).update(value).digest('base64url');}
function fingerprint(config){return crypto.createHash('sha256').update(config.hash).digest('base64url').slice(0,16);}
function issueSession(config,now=Date.now()){const body=Buffer.from(JSON.stringify({v:1,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+43200,nonce:crypto.randomBytes(16).toString('base64url'),pwd:fingerprint(config)})).toString('base64url');return `${body}.${sign(body,config)}`;}
function authenticated(req,config,now=Date.now()){
  const cookies=String(req.headers.cookie||'').split(';').map(x=>x.trim());const match=cookies.find(x=>x.startsWith(COOKIE+'='));if(!match)return false;
  const token=match.slice(COOKIE.length+1);if(token.length>2000)return false;const [body,signature,...extra]=token.split('.');if(!body||!signature||extra.length)return false;
  const expected=Buffer.from(sign(body,config));const received=Buffer.from(signature);if(expected.length!==received.length||!crypto.timingSafeEqual(expected,received))return false;
  try{const p=JSON.parse(Buffer.from(body,'base64url'));const seconds=Math.floor(now/1000);return p.v===1&&Number.isSafeInteger(p.exp)&&Number.isSafeInteger(p.iat)&&p.exp>seconds&&p.iat<=seconds+60&&p.exp-p.iat===43200&&p.pwd===fingerprint(config);}catch{return false;}
}
function sessionCookie(value,logout=false){return `${COOKIE}=${logout?'':value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${logout?0:43200}`;}
function checkOrigin(req){const host=String(req.headers.host||'');if(!/^[A-Za-z0-9.:[\]-]+$/.test(host))throw new HubError('invalid_origin','올바른 접속 주소가 아닙니다.',403);const local=/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);const scheme=local&&process.env.NODE_ENV!=='production'?'http':'https';if(req.headers.origin!==`${scheme}://${host}`||req.headers['sec-fetch-site']==='cross-site')throw new HubError('invalid_origin','다른 사이트에서 보낸 요청은 허용되지 않습니다.',403);}
function rateIdentity(req,config){const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();return crypto.createHmac('sha256',config.secret).update(ip).digest('hex').slice(0,32);}
module.exports={configuration,encrypt,decrypt,verifyPassword,issueSession,authenticated,sessionCookie,checkOrigin,rateIdentity,COOKIE};
