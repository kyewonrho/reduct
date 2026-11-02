'use strict';
const {HubError,keys,required}=require('../lib/project-hub/validation');
const Security=require('../lib/project-hub/security');
const {Store}=require('../lib/project-hub/store');

async function body(req){
  const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw new HubError('invalid_content_type','JSON 형식의 요청만 허용됩니다.',415);
  let value=req.body;
  if(value===undefined){const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1048576)throw new HubError('request_too_large','요청 내용이 너무 큽니다.',413);chunks.push(chunk);}value=Buffer.concat(chunks);}
  try{if(Buffer.isBuffer(value))value=value.toString('utf8');if(typeof value==='string'){if(Buffer.byteLength(value)>1048576)throw new Error();value=JSON.parse(value);}else if(Buffer.byteLength(JSON.stringify(value))>1048576)throw new Error();}catch{throw new HubError('invalid_json','요청 내용을 읽을 수 없습니다. JSON 형식을 확인하세요.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HubError('invalid_input','요청은 JSON 객체여야 합니다.');
  return value;
}
function reply(res,status,value,headers={}){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Vary','Cookie');for(const [key,value] of Object.entries(headers))res.setHeader(key,value);res.end(JSON.stringify(value));}
function createHandler(dependencies={}){
  return async function handler(req,res){
    try{
      const config=(dependencies.configuration||Security.configuration)();
      const store=dependencies.store||new Store(config);
      const url=new URL(req.url,'https://internal.invalid');
      const resource=url.searchParams.get('resource')||'state';
      const id=url.searchParams.get('id');
      if([...url.searchParams.keys()].some(key=>!['resource','id'].includes(key))||url.searchParams.getAll('resource').length>1||url.searchParams.getAll('id').length>1)throw new HubError('invalid_input','요청 주소가 올바르지 않습니다.');
      const method=req.method||'GET';
      if(!['GET','POST','PATCH','DELETE'].includes(method))throw new HubError('method_not_allowed','지원하지 않는 요청 방식입니다.',405);
      if(method!=='GET')Security.checkOrigin(req);
      const signedIn=Security.authenticated(req,config);
      if(resource==='auth'){
        if(method==='GET')return reply(res,200,{authenticated:signedIn});
        if(method==='DELETE'){const payload=await body(req);keys(payload,[],'요청');return reply(res,200,{authenticated:false},{'Set-Cookie':Security.sessionCookie('',true)});}
        if(method!=='POST')throw new HubError('method_not_allowed','지원하지 않는 로그인 요청입니다.',405);
        const payload=await body(req);keys(payload,['password'],'로그인');required(payload,['password'],'로그인');
        await store.rateLimit(Security.rateIdentity(req,config));
        if(!await Security.verifyPassword(payload.password,config))throw new HubError('invalid_credentials','비밀번호가 올바르지 않습니다.',401);
        return reply(res,200,{authenticated:true},{'Set-Cookie':Security.sessionCookie(Security.issueSession(config))});
      }
      if(!signedIn)throw new HubError('unauthorized','로그인이 필요합니다.',401);
      if(method==='GET'&&['state','export','health'].includes(resource)){
        const state=await store.read();
        if(resource==='health')return reply(res,200,{app:'reduct-project-hub',revision:state.revision});
        if(resource==='export')return reply(res,200,state,{'Content-Disposition':'attachment; filename="REDUCT_Project_Hub_Backup.json"'});
        state.storeInfo={path:'공용 클라우드 저장소'};return reply(res,200,state);
      }
      if(method==='POST'&&resource==='projects'){
        const payload=await body(req);keys(payload,['project','actor','requestId'],'요청');required(payload,['project'],'요청');return reply(res,201,await store.addProject(payload.project,Object.hasOwn(payload,'actor')?payload.actor:'',payload.requestId));
      }
      if(method==='POST'&&resource==='schedules'){
        const payload=await body(req);keys(payload,['schedule','actor','requestId'],'요청');required(payload,['schedule'],'요청');return reply(res,201,await store.addSchedule(payload.schedule,Object.hasOwn(payload,'actor')?payload.actor:'',payload.requestId));
      }
      if(method==='PATCH'&&['projects','activities','budget','schedules'].includes(resource)){
        const payload=await body(req);keys(payload,['version','changes','actor'],'요청');required(payload,['version','changes'],'요청');const args=[payload.version,payload.changes,Object.hasOwn(payload,'actor')?payload.actor:''];
        if(resource==='budget')return reply(res,200,await store.patchBudget(...args));
        if(typeof id!=='string'||!id||id.length>100||!/^[A-Za-z0-9_-]+$/.test(id))throw new HubError('invalid_input','수정할 항목 ID가 필요합니다.');
        if(resource==='schedules')return reply(res,200,await store.patchSchedule(id,...args));
        return reply(res,200,await(resource==='projects'?store.patchProject(id,...args):store.patchActivity(id,...args)));
      }
      throw new HubError('not_found','요청한 기능을 찾을 수 없습니다.',404);
    }catch(error){
      if(error instanceof HubError)return reply(res,error.status,error.payload(),error.status===429?{'Retry-After':'900'}:{});
      // Never return request bodies, passwords, keys, provider errors or tokens.
      return reply(res,500,{error:'internal_error',message:'요청을 처리하지 못했습니다. 입력 내용과 공용 저장소 상태를 확인하세요.'});
    }
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
