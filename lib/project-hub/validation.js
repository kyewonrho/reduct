'use strict';

const {randomUUID} = require('node:crypto');
const CATEGORIES = ['manufacturing', 'onestop', 'circuit', 'structure', 'internal'];
const STATUSES = ['in_progress', 'rework', 'quote', 'waiting', 'hold', 'unknown'];
const STAGE_STATES = ['unknown', 'done', 'active', 'planned', 'rework'];
const LABELS = {manufacturing:['검토·준비','제작','제작 완료','입고'],onestop:['기획·착수','설계','제작·연동','완료'],circuit:['요구사항','회로설계','제작·시험','완료'],structure:['콘셉트','3D 모델링','검토·수정','완료'],internal:['문서초안','외관디자인','제출준비','최종제출']};
const TEXT = {code:40,client:300,task:1000,owner:100,current:6000,source:10000};
const DATES = ['productionDue','windowStart','dueDate','productionDoneDate','receiptDoneDate','finalDoneDate'];
const BOOLS = ['productionDone','receiptDone','finalDone','archived'];
const EDITABLE = [...Object.keys(TEXT),...DATES,...BOOLS,'category','status','progress','quantityDone','quantityTotal','stages'];
const ACTIVITY_TEXT = {code:40,category:100,title:1000,owner:100,current:6000,notes:10000};
const ACTIVITY_EDITABLE = [...Object.keys(ACTIVITY_TEXT),'dueDate','doneDate','done','startTime','durationMinutes'];
const SCHEDULE_KINDS = ['meeting','conference','trip','other'];
const SCHEDULE_TEXT = {title:300,attendees:1000,location:1000,notes:10000};
const SCHEDULE_EDITABLE = ['kind',...Object.keys(SCHEDULE_TEXT),'startDate','endDate','allDay','startTime','endTime','archived'];
class HubError extends Error {
  constructor(code,message,status=400,latest) {super(message);this.code=code;this.status=status;if(latest!==undefined)this.latest=latest;}
  payload(){return {error:this.code,message:this.message,...(this.latest===undefined?{}:{latest:this.latest})};}
}
const fail = message => {throw new HubError('invalid_input',message);};
function object(value,name='입력'){if(!value || typeof value!=='object' || Array.isArray(value))fail(`${name}은 객체여야 합니다.`);}
function keys(value,allowed,name='입력'){object(value,name);if(Object.keys(value).some(key=>!allowed.includes(key)))throw new HubError('invalid_field',`허용되지 않은 ${name} 항목이 있습니다.`);}
function required(value,fields,name){if(fields.some(key=>!Object.hasOwn(value,key)))fail(`${name} 필수 항목이 누락되었습니다.`);}
function text(value,name,limit){if(typeof value!=='string'||value.length>limit||value.includes('\0'))fail(`${name}: ${limit}자 이하의 문자열을 입력하세요.`);}
function number(value,name,low=0,high=Number.MAX_SAFE_INTEGER,nullable=false,integer=false){if(value===null&&nullable)return;if(typeof value!=='number'||!Number.isFinite(value)||value<low||value>high||(integer&&!Number.isSafeInteger(value)))throw new HubError('invalid_number',`${name}: 올바른 범위의 숫자를 입력하세요.`);}
function date(value,name){if(value===null)return;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HubError('invalid_date',`${name}: YYYY-MM-DD 형식으로 입력하세요.`);const parsed=new Date(`${value}T00:00:00Z`);if(value.startsWith('0000-')||!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value)throw new HubError('invalid_date',`${name}: 존재하지 않는 날짜입니다.`);}
function timestamp(value,name){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(`${name}: 올바른 날짜와 시간이 필요합니다.`);}
function member(value,options,name){if(!options.includes(value))fail(`${name} 값이 올바르지 않습니다.`);}
function uuid(value,name='요청 ID'){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail(`${name}가 올바르지 않습니다.`);}
function validateProject(p){
  const fields=[...EDITABLE,'id','version','createdAt','updatedAt'];keys(p,[...fields,'creationRequestId'],'프로젝트');required(p,fields,'프로젝트');
  uuid(p.id,'프로젝트 ID');
  if(Object.hasOwn(p,'creationRequestId'))uuid(p.creationRequestId);
  number(p.version,'version',1,Number.MAX_SAFE_INTEGER,false,true);
  for(const [key,limit] of Object.entries(TEXT))text(p[key],key,limit);
  if(!p.code.trim())fail('프로젝트 코드가 필요합니다.');
  member(p.category,CATEGORIES,'분야');member(p.status,STATUSES,'상태');
  for(const key of DATES)date(p[key],key);
  for(const key of BOOLS)if(!(p[key]===null&&['productionDone','receiptDone'].includes(key))&&typeof p[key]!=='boolean')fail(`${key}: 체크 여부가 올바르지 않습니다.`);
  number(p.progress,'progress',0,100,true);number(p.quantityDone,'quantityDone',0,1000000000,true,true);number(p.quantityTotal,'quantityTotal',1,1000000000,true,true);
  if(p.quantityDone!==null&&p.quantityTotal!==null&&p.quantityDone>p.quantityTotal)fail('완료 수량은 전체 수량보다 클 수 없습니다.');
  if(p.windowStart&&p.dueDate&&p.windowStart>p.dueDate)throw new HubError('invalid_date','예정일 범위의 시작일이 종료일보다 늦습니다.');
  if(!Array.isArray(p.stages)||p.stages.length!==4)fail('진행 단계는 정확히 4개여야 합니다.');
  for(const stage of p.stages){keys(stage,['label','state'],'진행 단계');required(stage,['label','state'],'진행 단계');text(stage.label,'단계 이름',40);if(!stage.label.trim())fail('단계 이름이 필요합니다.');member(stage.state,STAGE_STATES,'단계 상태');}
  timestamp(p.createdAt,'createdAt');timestamp(p.updatedAt,'updatedAt');
}
function validateActivity(a){const fields=[...ACTIVITY_EDITABLE,'id','version','projectId'];keys(a,fields,'활동');required(a,fields,'활동');text(a.id,'활동 ID',100);text(a.projectId,'프로젝트 ID',100);number(a.version,'version',1,Number.MAX_SAFE_INTEGER,false,true);for(const [key,limit] of Object.entries(ACTIVITY_TEXT))text(a[key],key,limit);date(a.dueDate,'dueDate');date(a.doneDate,'doneDate');if(typeof a.done!=='boolean')fail('활동 완료 여부가 올바르지 않습니다.');if(a.startTime!==null&&(typeof a.startTime!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.startTime)))fail('시작 시간은 HH:MM 형식으로 입력하세요.');number(a.durationMinutes,'durationMinutes',0,1000000,true,true);}
function validateBudget(b){keys(b,['version','projectId','total','spent'],'활동비');required(b,['version','projectId','total','spent'],'활동비');number(b.version,'version',1,Number.MAX_SAFE_INTEGER,false,true);text(b.projectId,'프로젝트 ID',100);number(b.total,'total',0,1e15);number(b.spent,'spent',0,1e15);}
function validateSchedule(schedule){
  const fields=[...SCHEDULE_EDITABLE,'id','version','createdAt','updatedAt'];
  keys(schedule,[...fields,'creationRequestId'],'일정');required(schedule,fields,'일정');
  uuid(schedule.id,'일정 ID');number(schedule.version,'version',1,Number.MAX_SAFE_INTEGER,false,true);
  if(Object.hasOwn(schedule,'creationRequestId'))uuid(schedule.creationRequestId);
  member(schedule.kind,SCHEDULE_KINDS,'일정 종류');
  for(const [key,limit] of Object.entries(SCHEDULE_TEXT))text(schedule[key],key,limit);
  if(!schedule.title.trim())fail('일정 제목을 입력하세요.');
  for(const key of ['allDay','archived'])if(typeof schedule[key]!=='boolean')fail(`${key}: 체크 여부가 올바르지 않습니다.`);
  for(const key of ['startDate','endDate']){if(schedule[key]===null)throw new HubError('invalid_date','시작일과 종료일을 입력하세요.');date(schedule[key],key);}
  if(schedule.allDay){
    if(schedule.startTime!==null||schedule.endTime!==null)fail('종일 일정의 시작·종료 시간은 비워 두세요.');
  }else{
    for(const key of ['startTime','endTime'])if(typeof schedule[key]!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule[key]))fail('시간 일정은 시작·종료 시간을 HH:MM 형식으로 입력하세요.');
  }
  const start=`${schedule.startDate}T${schedule.startTime||'00:00'}`;
  const end=`${schedule.endDate}T${schedule.endTime||'00:00'}`;
  if(end<start)throw new HubError('invalid_date','일정 종료일시는 시작일시보다 빠를 수 없습니다.');
  timestamp(schedule.createdAt,'createdAt');timestamp(schedule.updatedAt,'updatedAt');
}
function validateState(s){
  const fields=['schemaVersion','revision','updatedAt','projects','activities','budget','history'];keys(s,[...fields,'schedules'],'데이터');required(s,fields,'데이터');if(s.schemaVersion!==1)fail('지원하지 않는 데이터 형식입니다.');number(s.revision,'revision',1,Number.MAX_SAFE_INTEGER,false,true);timestamp(s.updatedAt,'updatedAt');
  if(!Array.isArray(s.projects)||!Array.isArray(s.activities)||!Array.isArray(s.history))fail('데이터 목록이 올바르지 않습니다.');
  const ids=new Set(),codes=new Set(),requests=new Set();for(const p of s.projects){validateProject(p);const code=p.code.trim().toLowerCase();if(ids.has(p.id)||codes.has(code)||(p.creationRequestId&&requests.has(p.creationRequestId)))fail('중복 프로젝트가 있습니다.');ids.add(p.id);codes.add(code);if(p.creationRequestId)requests.add(p.creationRequestId);}
  const activityIds=new Set();for(const a of s.activities){validateActivity(a);if(!ids.has(a.projectId)||activityIds.has(a.id))fail('활동의 연결 프로젝트 또는 ID가 올바르지 않습니다.');activityIds.add(a.id);}
  validateBudget(s.budget);if(!ids.has(s.budget.projectId))fail('활동비의 연결 프로젝트가 없습니다.');
  if(Object.hasOwn(s,'schedules')){
    if(!Array.isArray(s.schedules))fail('공유 일정 목록이 올바르지 않습니다.');
    const scheduleIds=new Set(),scheduleRequests=new Set();
    for(const schedule of s.schedules){validateSchedule(schedule);if(scheduleIds.has(schedule.id)||(schedule.creationRequestId&&scheduleRequests.has(schedule.creationRequestId)))fail('중복 공유 일정이 있습니다.');scheduleIds.add(schedule.id);if(schedule.creationRequestId)scheduleRequests.add(schedule.creationRequestId);}
  }
  for(const h of s.history){keys(h,['at','actor','action','projectId','summary'],'이력');required(h,['at','actor','action','projectId','summary'],'이력');timestamp(h.at,'이력 일시');for(const key of ['actor','action','projectId','summary'])text(h[key],key,20000);}
}
function actor(value=''){text(value,'담당자',100);return value.trim();}
function checkVersion(record,version){number(version,'version',1,Number.MAX_SAFE_INTEGER,false,true);if(version!==record.version)throw new HubError('conflict','다른 담당자가 먼저 수정했습니다. 최신 내용을 확인하고 다시 저장하세요.',409,structuredClone(record));}
function assignCode(p,projects){text(p.code,'프로젝트 코드',40);const used=new Set(projects.filter(x=>x.id!==p.id).map(x=>x.code.trim().toLowerCase()));if(!p.code.trim()){member(p.category,CATEGORIES,'분야');const prefix={manufacturing:'M',onestop:'O',circuit:'C',structure:'S',internal:'I'}[p.category];let n=1;while(used.has(`${prefix}${n}`.toLowerCase()))n++;p.code=`${prefix}${n}`;}else p.code=p.code.trim();if(used.has(p.code.toLowerCase()))throw new HubError('duplicate_code','이미 사용 중인 프로젝트 코드입니다.',409);}
function completionDates(p,changes){const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);for(const [flag,key] of [['productionDone','productionDoneDate'],['receiptDone','receiptDoneDate'],['finalDone','finalDoneDate']])if(changes[flag]===true&&p[key]===null)p[key]=today;}
function newProject(fields,projects,requestId){keys(fields,EDITABLE,'프로젝트');const category=Object.hasOwn(fields,'category')?fields.category:'manufacturing';member(category,CATEGORIES,'분야');const now=new Date().toISOString();const p={id:randomUUID(),version:1,code:'',category,client:'신규 프로젝트',task:'',owner:'',status:'in_progress',progress:null,quantityDone:null,quantityTotal:null,current:'',source:'',stages:LABELS[category].map(label=>({label,state:'unknown'})),createdAt:now,updatedAt:now};for(const key of DATES)p[key]=null;for(const key of BOOLS)p[key]=false;Object.assign(p,structuredClone(fields));if(requestId!==undefined){uuid(requestId);p.creationRequestId=requestId;}assignCode(p,projects);completionDates(p,fields);validateProject(p);return p;}
function newSchedule(fields,requestId){
  keys(fields,SCHEDULE_EDITABLE,'일정');
  const now=new Date().toISOString(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const schedule={id:randomUUID(),version:1,kind:'meeting',title:'새 일정',attendees:'',startDate:today,endDate:Object.hasOwn(fields,'startDate')?fields.startDate:today,allDay:true,startTime:null,endTime:null,location:'',notes:'',archived:false,createdAt:now,updatedAt:now,...structuredClone(fields)};
  if(requestId!==undefined){uuid(requestId);schedule.creationRequestId=requestId;}
  validateSchedule(schedule);return schedule;
}
module.exports={HubError,keys,required,text,number,uuid,validateProject,validateActivity,validateBudget,validateSchedule,validateState,actor,checkVersion,assignCode,completionDates,newProject,newSchedule,EDITABLE,ACTIVITY_EDITABLE,SCHEDULE_EDITABLE};
