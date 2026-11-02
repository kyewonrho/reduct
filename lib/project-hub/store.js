'use strict';
const fs=require('node:fs');
const path=require('node:path');
const V=require('./validation');
const {encrypt,decrypt}=require('./security');

// The raw ciphertext is compared inside Redis before backup + replacement.
// Retrying a CAS reapplies only the requested record patch to the latest state.
const CAS_SCRIPT=`
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then return 0 end
redis.call('LPUSH', KEYS[2], current)
redis.call('LTRIM', KEYS[2], 0, 99)
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
const RATE_SCRIPT=`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`;

class Redis {
  constructor(config,fetcher=globalThis.fetch){this.config=config;this.fetcher=fetcher;}
  async command(...args){
    try{
      const response=await this.fetcher(this.config.url,{method:'POST',headers:{Authorization:`Bearer ${this.config.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000),cache:'no-store'});
      if(!response.ok)throw new Error();
      const data=await response.json();
      if(!data||Object.hasOwn(data,'error')||!Object.hasOwn(data,'result'))throw new Error();
      return data.result;
    }catch{throw new V.HubError('storage_unavailable','공용 저장소에 연결할 수 없습니다. 저장되지 않은 내용을 유지하고 잠시 후 다시 시도하세요.',503);}
  }
}

class Store {
  constructor(config,redis=new Redis(config),seedLoader){this.config=config;this.redis=redis;this.stateKey=`${config.namespace}:state`;this.backupKey=`${config.namespace}:backups`;this.seedLoader=seedLoader||(()=>fs.readFileSync(path.join(__dirname,'seed.enc.json'),'utf8'));}
  decode(raw){const state=decrypt(raw,this.config.key);try{V.validateState(state);}catch{throw new V.HubError('corrupt_data','공용 데이터 형식이 올바르지 않습니다. 원본을 유지했습니다. 관리자에게 문의하세요.',503);}if(!Object.hasOwn(state,'schedules'))state.schedules=[];return state;}
  async snapshot(){
    let raw=await this.redis.command('GET',this.stateKey);
    if(raw===null){
      let seed;
      try{seed=this.decode(await this.seedLoader());}catch(error){if(error instanceof V.HubError)throw error;throw new V.HubError('seed_unavailable','초기 프로젝트 데이터를 불러올 수 없습니다. 관리자에게 문의하세요.',503);}
      const initial=encrypt(seed,this.config.key);
      await this.redis.command('SET',this.stateKey,initial,'NX');
      raw=await this.redis.command('GET',this.stateKey);
    }
    if(typeof raw!=='string')throw new V.HubError('corrupt_data','공용 데이터 형식을 확인할 수 없습니다. 원본을 유지했습니다.',503);
    return {raw,state:this.decode(raw)};
  }
  async read(){return (await this.snapshot()).state;}
  async rateLimit(identity){const count=await this.redis.command('EVAL',RATE_SCRIPT,1,`${this.config.namespace}:login:${identity}`,900);if(!Number.isInteger(count)||count<1)throw new V.HubError('storage_unavailable','로그인 보호 기능에 연결할 수 없습니다. 잠시 후 다시 시도하세요.',503);if(count>10)throw new V.HubError('rate_limited','로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.',429);}
  async mutate(actor,operation){
    const by=V.actor(actor);
    for(let attempt=0;attempt<8;attempt++){
      const {raw,state}=await this.snapshot();
      const next=structuredClone(state);
      const change=operation(next);
      if(change.noop)return {...change.result,revision:state.revision};
      const now=new Date().toISOString();next.revision=state.revision+1;next.updatedAt=now;
      next.history.push({at:now,actor:by,action:change.action,projectId:change.projectId,summary:change.summary});
      next.history=next.history.slice(-1000);
      V.validateState(next);
      const saved=await this.redis.command('EVAL',CAS_SCRIPT,2,this.stateKey,this.backupKey,raw,encrypt(next,this.config.key));
      if(saved===1)return {...change.result,revision:next.revision};
      if(saved!==0)throw new V.HubError('storage_unavailable','저장 결과를 확인할 수 없습니다. 최신 데이터를 확인하세요.',503);
    }
    throw new V.HubError('store_busy','다른 담당자가 저장 중입니다. 최신 내용을 확인한 후 다시 시도하세요.',503);
  }
  addProject(fields,actor='',requestId){
    V.keys(fields,V.EDITABLE,'프로젝트');
    if(requestId!==undefined)V.uuid(requestId);
    return this.mutate(actor,state=>{if(requestId!==undefined){const existing=state.projects.find(p=>p.creationRequestId===requestId);if(existing)return {noop:true,result:{project:existing}};}const project=V.newProject(fields,state.projects,requestId);state.projects.push(project);return {result:{project},action:'project.create',projectId:project.id,summary:`프로젝트 추가: ${project.client} / ${project.task}`};});
  }
  patchProject(id,version,changes,actor=''){
    V.keys(changes,V.EDITABLE,'프로젝트');
    return this.mutate(actor,state=>{const project=state.projects.find(p=>p.id===id);if(!project)throw new V.HubError('not_found','프로젝트를 찾을 수 없습니다.',404);V.checkVersion(project,version);if(!Object.keys(changes).length)return {noop:true,result:{project}};Object.assign(project,structuredClone(changes));V.assignCode(project,state.projects);V.completionDates(project,changes);project.version++;project.updatedAt=new Date().toISOString();V.validateProject(project);return {result:{project},action:'project.update',projectId:id,summary:`${project.code} 수정: ${Object.keys(changes).sort().join(', ')}`};});
  }
  patchActivity(id,version,changes,actor=''){
    V.keys(changes,V.ACTIVITY_EDITABLE,'활동');
    return this.mutate(actor,state=>{const activity=state.activities.find(a=>a.id===id);if(!activity)throw new V.HubError('not_found','활동을 찾을 수 없습니다.',404);V.checkVersion(activity,version);if(!Object.keys(changes).length)return {noop:true,result:{activity}};Object.assign(activity,structuredClone(changes));if(changes.done===true&&activity.doneDate===null)activity.doneDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10);activity.version++;V.validateActivity(activity);return {result:{activity},action:'activity.update',projectId:activity.projectId,summary:`활동 수정: ${activity.title} / ${Object.keys(changes).sort().join(', ')}`};});
  }
  patchBudget(version,changes,actor=''){
    V.keys(changes,['total','spent'],'활동비');
    return this.mutate(actor,state=>{const budget=state.budget;V.checkVersion(budget,version);if(!Object.keys(changes).length)return {noop:true,result:{budget}};Object.assign(budget,structuredClone(changes));budget.version++;V.validateBudget(budget);return {result:{budget},action:'budget.update',projectId:budget.projectId,summary:`활동비 수정: ${Object.keys(changes).sort().join(', ')}`};});
  }
  addSchedule(fields,actor='',requestId){
    V.keys(fields,V.SCHEDULE_EDITABLE,'일정');
    if(requestId!==undefined)V.uuid(requestId);
    return this.mutate(actor,state=>{
      if(requestId!==undefined){const existing=state.schedules.find(schedule=>schedule.creationRequestId===requestId);if(existing)return {noop:true,result:{schedule:existing}};}
      const schedule=V.newSchedule(fields,requestId);state.schedules.push(schedule);
      return {result:{schedule},action:'schedule.create',projectId:'',summary:`일정 추가: ${schedule.title} [${schedule.id}]`};
    });
  }
  patchSchedule(id,version,changes,actor=''){
    V.keys(changes,V.SCHEDULE_EDITABLE,'일정');
    return this.mutate(actor,state=>{
      const schedule=state.schedules.find(item=>item.id===id);
      if(!schedule)throw new V.HubError('not_found','공유 일정을 찾을 수 없습니다.',404);
      V.checkVersion(schedule,version);
      if(!Object.keys(changes).length)return {noop:true,result:{schedule}};
      Object.assign(schedule,structuredClone(changes));schedule.version++;schedule.updatedAt=new Date().toISOString();V.validateSchedule(schedule);
      return {result:{schedule},action:'schedule.update',projectId:'',summary:`일정 수정: ${schedule.title} [${schedule.id}] / ${Object.keys(changes).sort().join(', ')}`};
    });
  }
}
module.exports={Redis,Store,CAS_SCRIPT,RATE_SCRIPT};
