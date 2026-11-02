'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const V=require('./validation');
const S=require('./security');
const {Store,Redis,CAS_SCRIPT,RATE_SCRIPT}=require('./store');
const {createHandler}=require('../../api/project-hub');

function config(){const salt=crypto.randomBytes(16),password='local-test-password';return S.configuration({UPSTASH_REDIS_REST_URL:'https://test.invalid',UPSTASH_REDIS_REST_TOKEN:'test-token',PROJECT_HUB_PASSWORD_HASH:`scrypt$16384$8$1$${salt.toString('base64url')}$${crypto.scryptSync(password,salt,32,{N:16384,r:8,p:1}).toString('base64url')}`,PROJECT_HUB_SESSION_SECRET:crypto.randomBytes(32).toString('base64url'),PROJECT_HUB_DATA_KEY:crypto.randomBytes(32).toString('base64url')});}
function fixture(){const projects=[V.newProject({client:'Synthetic one',code:'M1'},[]),V.newProject({client:'Synthetic two',code:'M2'},[])];return {schemaVersion:1,revision:1,updatedAt:new Date().toISOString(),projects,activities:[{id:'activity-one',version:1,projectId:projects[0].id,code:'A1',category:'mentor',title:'Test meeting',owner:'',dueDate:null,doneDate:null,done:false,current:'',notes:'',startTime:null,durationMinutes:null}],budget:{version:1,projectId:projects[0].id,total:2000000,spent:0},history:[]};}
// A deterministic Redis protocol double. Each EVAL is one synchronous atomic
// step while GET yields, so independently issued writes race at the CAS boundary.
class FakeRedis {
  constructor(){this.values=new Map();this.backups=[];this.calls=[];}
  async command(...args){this.calls.push(args);const [command,key,...rest]=args;
    if(command==='GET'){const value=this.values.get(key)??null;await new Promise(resolve=>setImmediate(resolve));return value;}
    if(command==='SET'){if(rest[1]==='NX'&&this.values.has(key))return null;this.values.set(key,rest[0]);return 'OK';}
    if(command==='EVAL'&&key===CAS_SCRIPT){const [count,stateKey,backupKey,expected,next]=rest;assert.equal(count,2);if(this.values.get(stateKey)!==expected)return 0;this.backups.unshift(expected);this.backups=this.backups.slice(0,100);this.values.set(stateKey,next);if(this.failNextAppliedCas){this.failNextAppliedCas=false;throw new V.HubError('storage_unavailable','Simulated lost reply',503);}return 1;}
    if(command==='EVAL'&&key===RATE_SCRIPT){const rateKey=rest[1];const count=(this.values.get(rateKey)||0)+1;this.values.set(rateKey,count);return count;}
    throw new Error('Unexpected Redis command');
  }
}
function setup(state=fixture()){const c=config(),redis=new FakeRedis(),seed=S.encrypt(state,c.key),store=new Store(c,redis,()=>seed);return {c,redis,store,state};}
function request(handler,method,resource,payload,cookie,origin='https://hub.example'){
  const headers={host:'hub.example',origin,'content-type':'application/json'};if(cookie)headers.cookie=cookie;
  const req={method,url:`/api/project-hub?resource=${resource}`,headers,body:payload,socket:{remoteAddress:'127.0.0.1'}};
  return new Promise((resolve,reject)=>{const response={headers:{},setHeader(key,value){this.headers[key]=value;},end(raw){resolve({status:this.statusCode,headers:this.headers,value:JSON.parse(raw)});}};Promise.resolve(handler(req,response)).catch(reject);});
}

test('configuration fails closed without required durable storage and secrets',()=>{assert.throws(()=>S.configuration({}),error=>error.status===503);});
test('AES-GCM ciphertext rejects tampering and a wrong key',()=>{const c=config(),raw=S.encrypt({private:'never public'},c.key);assert(!raw.includes('never public'));assert.deepEqual(S.decrypt(raw,c.key),{private:'never public'});const broken=JSON.parse(raw);broken.tag=crypto.randomBytes(16).toString('base64url');assert.throws(()=>S.decrypt(broken,c.key),error=>error.code==='corrupt_data');assert.throws(()=>S.decrypt(raw,crypto.randomBytes(32)));});
test('signed sessions require authentic, unexpired cookies and invalidate on password change',()=>{const c=config(),token=S.issueSession(c,1000000);const req={headers:{cookie:S.sessionCookie(token)}};assert(S.authenticated(req,c,1001000));assert(!S.authenticated(req,c,1000000+43201000));assert(!S.authenticated({headers:{cookie:`${S.COOKIE}=${token}broken`}},c,1001000));assert(!S.authenticated(req,{...c,hash:c.hash+'changed'},1001000));});
test('first read SET NX seeds once; state and backups remain encrypted',async()=>{const {c,store,redis,state}=setup();await store.read();const store2=new Store(c,redis,()=>{throw new Error('must not reload seed');});assert.equal((await store2.read()).projects.length,2);await store.patchProject(state.projects[0].id,1,{owner:'SERVER-ONLY'},'tester');const raw=redis.values.get(store.stateKey);assert(!raw.includes('SERVER-ONLY'));assert.equal(redis.backups.length,1);assert.equal(S.decrypt(redis.backups[0],c.key).revision,1);assert.equal((await store2.read()).projects[0].owner,'SERVER-ONLY');});
test('two simultaneous record patches preserve both; stale version rejects with latest',async()=>{const {store,state}=setup();await store.read();await Promise.all(state.projects.map((p,i)=>store.patchProject(p.id,1,{owner:`worker-${i}`})));const after=await store.read();assert.equal(after.revision,3);assert.deepEqual(after.projects.map(p=>p.owner),['worker-0','worker-1']);assert.deepEqual(after.projects.map(p=>p.version),[2,2]);await assert.rejects(()=>store.patchProject(state.projects[0].id,1,{owner:'stale'}),error=>error.status===409&&error.latest.owner==='worker-0');});
test('same record/version has one winner; final flags are independent and progress survives',async()=>{const {store,state}=setup();await store.read();const id=state.projects[0].id;const results=await Promise.allSettled([store.patchProject(id,1,{owner:'one'}),store.patchProject(id,1,{owner:'two'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);let r=await store.patchProject(id,2,{progress:55,productionDone:true,receiptDone:true});assert.equal(r.project.finalDone,false);assert(r.project.productionDoneDate);r=await store.patchProject(id,3,{finalDone:true});assert(r.project.finalDoneDate);r=await store.patchProject(id,4,{finalDone:false});assert.equal(r.project.progress,55);});
test('corrupt existing cloud data is never replaced with seed',async()=>{const {store,redis}=setup();const broken='invalid encrypted state';redis.values.set(store.stateKey,broken);await assert.rejects(()=>store.read(),error=>error.code==='corrupt_data');assert.equal(redis.values.get(store.stateKey),broken);assert(!redis.calls.some(call=>call[0]==='SET'));});
test('invalid numbers, dates and unknown fields cannot save',async()=>{const {store,state,redis}=setup();await store.read();const raw=redis.values.get(store.stateKey);for(const changes of [{dueDate:'2026-02-30'},{progress:Infinity},{progress:true},{quantityDone:5,quantityTotal:4},{owner:10},{status:['quote']},{stages:[]},{id:'replacement'},{windowStart:'2026-11-20',dueDate:'2026-11-01'}])await assert.rejects(async()=>store.patchProject(state.projects[0].id,1,changes));assert.equal(redis.values.get(store.stateKey),raw);});
test('new project default codes, stage labels, duplicate codes and activity/budget conflicts',async()=>{const {store}=setup();const p=(await store.addProject({category:'internal',code:''})).project;assert.equal(p.code,'I1');assert.equal(p.stages[0].label,'문서초안');await assert.rejects(()=>store.addProject({code:' i1 '}),error=>error.code==='duplicate_code');const activity=(await store.patchActivity('activity-one',1,{done:true,startTime:'14:00',durationMinutes:60})).activity;assert(activity.doneDate);await assert.rejects(()=>store.patchActivity('activity-one',1,{owner:'old'}),error=>error.status===409);await store.patchBudget(1,{spent:2000000});await assert.rejects(()=>store.patchBudget(1,{total:1}),error=>error.status===409);});
test('history and durable encrypted backup retention are bounded',async()=>{const state=fixture();state.history=Array.from({length:1000},()=>({at:state.updatedAt,actor:'test',action:'old',projectId:state.projects[0].id,summary:'old'}));const {store,redis}=setup(state);for(let i=0;i<102;i++)await store.patchProject(state.projects[0].id,i+1,{owner:`n${i}`});assert.equal(redis.backups.length,100);assert.equal((await store.read()).history.length,1000);});
test('API denies private data before login; accepts password and secure cookie; logout clears cookie',async()=>{const {c,store}=setup();const handler=createHandler({configuration:()=>c,store});assert.equal((await request(handler,'GET','state')).status,401);assert.deepEqual((await request(handler,'GET','auth')).value,{authenticated:false});const login=await request(handler,'POST','auth',{password:'local-test-password'});assert.equal(login.status,200);const cookie=login.headers['Set-Cookie'];for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/'])assert(cookie.includes(flag));const state=await request(handler,'GET','state',undefined,cookie);assert.equal(state.status,200);assert.equal(state.value.projects.length,2);const exported=await request(handler,'GET','export',undefined,cookie);assert(!('storeInfo' in exported.value));assert(exported.headers['Content-Disposition'].includes('attachment'));const logout=await request(handler,'DELETE','auth',{},cookie);assert.equal(logout.value.authenticated,false);assert(logout.headers['Set-Cookie'].includes('Max-Age=0'));});
test('API origin checks and distributed login limit reject unsafe requests',async()=>{const {c,store}=setup();const handler=createHandler({configuration:()=>c,store});assert.equal((await request(handler,'POST','auth',{password:'local-test-password'},null,'https://attacker.example')).status,403);for(let i=0;i<10;i++)assert.equal((await request(handler,'POST','auth',{password:'wrong'})).status,401);const limited=await request(handler,'POST','auth',{password:'local-test-password'});assert.equal(limited.status,429);assert.equal(limited.headers['Retry-After'],'900');});
test('provider failure is 503 without leaking provider tokens',async()=>{const c=config(),redis=new Redis(c,async()=>{throw new Error(c.token);});await assert.rejects(()=>redis.command('GET','state'),error=>error.status===503&&!error.message.includes(c.token));const handler=createHandler({configuration:()=>{throw new V.HubError('not_configured','Setup required',503);}});assert.equal((await request(handler,'GET','auth')).status,503);});
test('creation retry after an applied write loses its reply returns one original project',async()=>{const {store,redis}=setup();await store.read();const requestId=crypto.randomUUID();redis.failNextAppliedCas=true;await assert.rejects(()=>store.addProject({client:'Retry-safe'},'tester',requestId),error=>error.status===503);const retried=await store.addProject({client:'Retry-safe'},'tester',requestId);const state=await store.read();assert.equal(state.projects.length,3);assert.equal(state.projects.filter(p=>p.creationRequestId===requestId).length,1);assert.equal(retried.project.id,state.projects[2].id);assert.equal(state.revision,2);assert.equal(redis.backups.length,1);await assert.rejects(async()=>store.patchProject(retried.project.id,1,{creationRequestId:crypto.randomUUID()}),error=>error.code==='invalid_field');});
test('simultaneous creations sharing requestId have one durable result',async()=>{const {store}=setup();await store.read();const requestId=crypto.randomUUID();const results=await Promise.all([store.addProject({client:'Concurrent create'},'',requestId),store.addProject({client:'Concurrent create'},'',requestId)]);assert.equal(results[0].project.id,results[1].project.id);assert.equal((await store.read()).projects.length,3);assert.equal((await store.read()).revision,2);});
test('packed REDUCT supports exactly the three secret assignments with CRLF and optional quotes',()=>{
  const c=config();
  const values={PROJECT_HUB_PASSWORD_HASH:c.hash,PROJECT_HUB_SESSION_SECRET:c.secret,PROJECT_HUB_DATA_KEY:c.key.toString('base64url')};
  const redis={UPSTASH_REDIS_REST_URL:c.url,UPSTASH_REDIS_REST_TOKEN:c.token};
  for(const packed of [Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n'),Object.entries(values).map(([k,v])=>`${k}="${v}"`).join('\r\n'),"'"+Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\r\n')+"'"]){
    const parsed=S.configuration({...redis,REDUCT:packed});
    assert.equal(parsed.hash,c.hash);assert.equal(parsed.secret,c.secret);assert.deepEqual(parsed.key,c.key);
  }
  // Complete explicit configuration wins; a partial one is never merged.
  assert.equal(S.configuration({...redis,...values,REDUCT:'ignored malformed value'}).hash,c.hash);
  assert.throws(()=>S.configuration({...redis,PROJECT_HUB_PASSWORD_HASH:c.hash,REDUCT:Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')}),error=>error.status===503);
});
test('packed REDUCT rejects a password, missing/duplicate/unwanted keys and malformed assignments without leaking values',()=>{
  const c=config(),lines=[`PROJECT_HUB_PASSWORD_HASH=${c.hash}`,`PROJECT_HUB_SESSION_SECRET=${c.secret}`,`PROJECT_HUB_DATA_KEY=${c.key.toString('base64url')}`];
  const redis={KV_REST_API_URL:c.url,KV_REST_API_TOKEN:c.token};
  for(const packed of ['plain-secret-password',lines.slice(0,2).join('\n'),[lines[0],lines[1],lines[1]].join('\n'),[lines[0],lines[1],'UNWANTED=do-not-use'].join('\n'),lines.join('\n')+'\nEXTRA=value',lines.join('\\n'),[lines[0],lines[1],`PROJECT_HUB_DATA_KEY="${c.key.toString('base64url')}`].join('\n'),[lines[0],'export '+lines[1],lines[2]].join('\n')]){
    assert.throws(()=>S.configuration({...redis,REDUCT:packed}),error=>error.status===503&&!error.message.includes(c.hash)&&!error.message.includes(c.secret)&&!error.message.includes('plain-secret-password'));
  }
  assert.throws(()=>S.configuration({REDUCT:lines.join('\n')}),error=>error.status===503);
});
test('legacy schedules migration is read-only and first addition preserves projects, activities and budget',async()=>{
  const {c,store,redis,state}=setup();
  const legacy=S.encrypt(state,c.key);redis.values.set(store.stateKey,legacy);
  const read=await store.read();assert.deepEqual(read.schedules,[]);assert.equal(read.revision,1);
  assert.equal(redis.values.get(store.stateKey),legacy);assert(!redis.calls.some(call=>call[0]==='SET'||call[0]==='EVAL'));
  const result=await store.addSchedule({title:'Standalone meeting',attendees:'Kim, Lee',startDate:'2026-11-03',endDate:'2026-11-03'},'Kim',crypto.randomUUID());
  assert.equal(result.schedule.version,1);assert.equal(result.schedule.kind,'meeting');assert.equal(result.schedule.allDay,true);assert.equal(result.schedule.startTime,null);assert(!('projectId' in result.schedule));
  const after=await store.read();assert.equal(after.revision,2);assert.deepEqual(after.projects,state.projects);assert.deepEqual(after.activities,state.activities);assert.deepEqual(after.budget,state.budget);assert.equal(after.schedules.length,1);
  assert.equal(after.history[0].action,'schedule.create');assert.equal(after.history[0].projectId,'');assert(after.history[0].summary.includes(result.schedule.id));
  assert(!Object.hasOwn(S.decrypt(redis.backups[0],c.key),'schedules'));
});
test('simultaneous schedule creation and project edit both survive the shared state CAS',async()=>{
  const {store,state}=setup();await store.read();
  await Promise.all([store.addSchedule({kind:'trip',title:'Site visit',startDate:'2026-11-03',endDate:'2026-11-05'},'Lee',crypto.randomUUID()),store.patchProject(state.projects[0].id,1,{owner:'Concurrent owner'},'Kim')]);
  const after=await store.read();assert.equal(after.revision,3);assert.equal(after.schedules.length,1);assert.equal(after.schedules[0].title,'Site visit');assert.equal(after.projects[0].owner,'Concurrent owner');assert.equal(after.projects[0].version,2);assert.equal(after.projects[1].version,1);assert.equal(after.activities[0].version,1);assert.equal(after.history.length,2);
});
test('schedule same-version edits conflict and archive/restore preserves the record',async()=>{
  const {store}=setup();const initial=(await store.addSchedule({title:'Review meeting',allDay:false,startDate:'2026-11-03',endDate:'2026-11-03',startTime:'14:00',endTime:'15:00'})).schedule;
  const results=await Promise.allSettled([store.patchSchedule(initial.id,1,{location:'Room A'},'Kim'),store.patchSchedule(initial.id,1,{location:'Room B'},'Lee')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const conflict=results.find(r=>r.status==='rejected').reason;assert.equal(conflict.status,409);assert.equal(conflict.latest.id,initial.id);assert.equal(conflict.latest.version,2);
  let result=await store.patchSchedule(initial.id,2,{archived:true});assert(result.schedule.archived);assert.equal(result.schedule.title,initial.title);result=await store.patchSchedule(initial.id,3,{archived:false});assert.equal(result.schedule.archived,false);assert.equal((await store.read()).schedules.length,1);
  const revision=(await store.read()).revision;await store.patchSchedule(initial.id,4,{});assert.equal((await store.read()).revision,revision);
});
test('schedule creation retries are idempotent after a lost reply and concurrent duplicate requests',async()=>{
  const {store,redis}=setup();await store.read();const requestId=crypto.randomUUID();redis.failNextAppliedCas=true;
  await assert.rejects(()=>store.addSchedule({title:'Uncertain save'},'Kim',requestId),error=>error.status===503);
  const retry=await store.addSchedule({title:'Uncertain save'},'Kim',requestId);assert.equal(retry.schedule.creationRequestId,requestId);assert.equal(retry.revision,2);assert.equal((await store.read()).schedules.length,1);assert.equal(redis.backups.length,1);
  const secondRequest=crypto.randomUUID(),results=await Promise.all([store.addSchedule({title:'Double click'},'',secondRequest),store.addSchedule({title:'Double click'},'',secondRequest)]);
  assert.equal(results[0].schedule.id,results[1].schedule.id);assert.equal((await store.read()).schedules.length,2);assert.equal((await store.read()).revision,3);
  await assert.rejects(async()=>store.patchSchedule(retry.schedule.id,1,{creationRequestId:crypto.randomUUID()}),error=>error.code==='invalid_field');
});
test('schedule date/time rules, required title and strict fields reject invalid writes without changes',async()=>{
  const {store,redis}=setup();await store.read();const original=redis.values.get(store.stateKey);
  const invalid=[{title:''},{title:' '.repeat(3)},{title:'x'.repeat(301)},{attendees:'x'.repeat(1001)},{location:'x'.repeat(1001)},{notes:'x'.repeat(10001)},{kind:'project'},
    {startDate:'2026-02-30'},{startDate:'0000-01-01'},{startDate:null},{startDate:'2026-11-05',endDate:'2026-11-04'},
    {allDay:true,startTime:'14:00',endTime:'15:00'},{allDay:false},{allDay:false,startTime:'14:00',endTime:null},{allDay:false,startTime:'24:00',endTime:'15:00'},
    {allDay:false,startDate:'2026-11-03',endDate:'2026-11-03',startTime:'15:00',endTime:'14:00'},{archived:'false'},{owner:'not-allowed'},{projectId:'not-allowed'},{version:9},{creationRequestId:crypto.randomUUID()}];
  for(const fields of invalid)await assert.rejects(async()=>store.addSchedule(fields));
  assert.equal(redis.values.get(store.stateKey),original);assert.equal(redis.backups.length,0);
  const overnight=(await store.addSchedule({title:'Overnight trip',allDay:false,startDate:'2026-11-03',endDate:'2026-11-04',startTime:'23:00',endTime:'01:00'})).schedule;assert.equal(overnight.endDate,'2026-11-04');
  const after=redis.values.get(store.stateKey);await assert.rejects(()=>store.patchSchedule(overnight.id,1,{endDate:'2026-11-03'}),error=>error.code==='invalid_date');assert.equal(redis.values.get(store.stateKey),after);
  const equal=(await store.addSchedule({title:'Same instant',allDay:false,startDate:'2026-11-03',endDate:'2026-11-03',startTime:'14:00',endTime:'14:00'})).schedule;assert.equal(equal.startTime,equal.endTime);
});
test('schedule API uses the existing authentication, same-origin, version conflict and export contract',async()=>{
  const {c,store}=setup(),handler=createHandler({configuration:()=>c,store});
  assert.equal((await request(handler,'POST','schedules',{schedule:{title:'Hidden'}})).status,401);
  const cookie=S.sessionCookie(S.issueSession(c));
  const denied=await request(handler,'POST','schedules',{schedule:{title:'Unsafe'}},cookie,'https://attacker.example');assert.equal(denied.status,403);
  const created=await request(handler,'POST','schedules',{schedule:{title:'Public team schedule'},actor:'Kim',requestId:crypto.randomUUID()},cookie);assert.equal(created.status,201);assert.equal(created.value.schedule.version,1);
  const id=created.value.schedule.id;
  const patched=await request(handler,'PATCH',`schedules&id=${id}`,{version:1,changes:{notes:'Shared note'},actor:'Lee'},cookie);assert.equal(patched.status,200);assert.equal(patched.value.schedule.notes,'Shared note');
  const stale=await request(handler,'PATCH',`schedules&id=${id}`,{version:1,changes:{notes:'Stale note'}},cookie);assert.equal(stale.status,409);assert.equal(stale.value.latest.notes,'Shared note');
  const unexpected=await request(handler,'POST','schedules',{schedule:{title:'Invalid',projectId:'forbidden'}},cookie);assert.equal(unexpected.status,400);
  assert.equal((await request(handler,'DELETE',`schedules&id=${id}`,{},cookie)).status,404);
  const exported=await request(handler,'GET','export',undefined,cookie);assert.equal(exported.value.schedules.length,1);assert.equal(exported.value.schedules[0].id,id);
});
test('corrupt schedule collections are preserved without automatic reseeding',async()=>{
  const {c,store,redis,state}=setup();
  for(const schedules of [null,{},[V.newSchedule({title:'One'}),{...V.newSchedule({title:'Bad'}),endDate:'invalid'}]]){
    const corrupted=S.encrypt({...state,schedules},c.key);redis.values.set(store.stateKey,corrupted);
    await assert.rejects(()=>store.read(),error=>error.code==='corrupt_data');assert.equal(redis.values.get(store.stateKey),corrupted);
  }
  assert(!redis.calls.some(call=>call[0]==='SET'||call[0]==='EVAL'));
});
