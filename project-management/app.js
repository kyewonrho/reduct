'use strict';

const CATEGORIES = {manufacturing:'제조',onestop:'원스톱 서비스',circuit:'회로개발',structure:'구조설계',internal:'내부 프로젝트'};
const STATUSES = {in_progress:'진행중',rework:'재제작중',quote:'견적검토',waiting:'착수대기',hold:'보류',unknown:'현황미입력'};
const STAGE_STATES = {unknown:'미확인',done:'완료',active:'진행',planned:'예정',rework:'재제작'};
const DEFAULT_STAGES = {manufacturing:['검토·준비','제작','제작 완료','입고'],onestop:['기획·착수','설계','제작·연동','완료'],circuit:['요구사항','회로설계','제작·시험','완료'],structure:['콘셉트','3D 모델링','검토·수정','완료'],internal:['문서초안','외관디자인','제출준비','최종제출']};
const WAITING = new Set(['quote','waiting','hold','unknown']);
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1});
const dateText = value => value ? `${Number(value.slice(5,7))}/${Number(value.slice(8,10))}` : '일정 미정';
const dateFull = value => value ? value.replaceAll('-','.') : '미입력';
const pct = value => `${number(value)}%`;
const isKnown = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const effectiveProgress = p => p.finalDone ? 100 : isKnown(p.progress) ? Number(p.progress) : null;
const activeProjects = () => state ? state.projects.filter(p=>!p.archived) : [];
const localDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateDelta = (a,b) => Math.round((Date.parse(`${a}T00:00:00Z`)-Date.parse(`${b}T00:00:00Z`))/86400000);
const addDays = (day,days) => {const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
let state = null;
let refreshing = null;
let editorBase = null;
let newProjectRequestId = null;
let activityBase = null;
let budgetBase = null;
let editorDirty = false;
let activityDirty = false;
let budgetDirty = false;
let savingProject = false;
let savingActivity = false;
let savingBudget = false;
let authenticated = false;
let sessionEpoch = 0;
let authenticating = false;
let searchTimer;
let projectView = 'list';
let calendarMonth = localDate().slice(0,7);
let calendarDate = localDate();
const expanded = new Set();
const pending = new Set();

function apiUrl(path){
  const match=/^\/api\/([a-z]+)(?:\/([^/]+))?$/.exec(path);
  if(!match)throw new Error('올바르지 않은 요청입니다.');
  const query=new URLSearchParams({resource:match[1]});
  if(match[2])query.set('id',decodeURIComponent(match[2]));
  return `/api/project-hub?${query}`;
}

async function api(path,options={}) {
  const requestEpoch=sessionEpoch;
  let response;
  try {response=await fetch(apiUrl(path),{cache:'no-store',credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});} catch(error) {throw Object.assign(new Error('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'),{cause:error});}
  const body=await response.json().catch(()=>({message:'서버 응답을 읽을 수 없습니다.'}));
  if(!response.ok){
    if(response.status===401&&path!=='/api/auth'&&requestEpoch===sessionEpoch)showGate('로그인이 만료되었습니다. 다시 로그인해 주세요. 저장하지 않은 편집 내용은 저장되지 않았습니다.',true);
    const message=response.status===503?(body.message||'프로젝트 관리 서버 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.'):body.message||'요청을 처리하지 못했습니다.';
    throw Object.assign(new Error(message),{status:response.status,body});
  }
  return body;
}

function showGate(message='',error=false){
  authenticated=false;sessionEpoch++;state=null;
  editorBase=null;newProjectRequestId=null;activityBase=null;budgetBase=null;expanded.clear();pending.clear();
  editorDirty=false;activityDirty=false;budgetDirty=false;
  for(const id of ['projectDialog','activityDialog','budgetDialog'])if($(id).open)$(id).close();
  for(const id of ['projectForm','activityForm','budgetForm'])$(id).reset();
  for(const id of ['overviewStats','categoryCounts','categoryChart','deadlineChart','projectList','projectCalendar','stageEditor','projectConflict','activityConflict'])$(id).replaceChildren();
  calendarMonth=localDate().slice(0,7);calendarDate=localDate();
  for(const id of ['projectFormError','activityFormError','budgetFormError'])fieldError(id,'');
  $('revisionText').textContent='공용 프로젝트 관리';$('storePath').textContent='모든 담당자가 같은 공용 데이터로 작업합니다.';
  $('notice').textContent='';$('notice').hidden=true;
  $('actorName').value='';
  $('searchInput').value='';$('categoryFilter').value='all';$('statusFilter').value='all';$('showArchived').checked=false;
  $('projectApp').hidden=true;$('loginGate').hidden=false;
  $('loginPassword').value='';$('loginMessage').textContent=message;$('loginMessage').classList.toggle('error',error);
}

async function checkSession(){
  authenticating=true;$('loginButton').disabled=true;
  try{
    const session=await api('/api/auth');
    if(session.authenticated){authenticated=true;sessionEpoch++;restoreActor();await refresh(true);}else showGate('');
  }catch(error){showGate(error.message,true);}
  finally{authenticating=false;$('loginButton').disabled=false;}
}

async function login(event){
  event.preventDefault();if(authenticating)return;
  authenticating=true;$('loginButton').disabled=true;$('loginButton').textContent='확인 중…';
  $('loginMessage').textContent='';$('loginMessage').classList.remove('error');
  try{
    const password=$('loginPassword').value;
    const session=await api('/api/auth',{method:'POST',body:JSON.stringify({password})});
    $('loginPassword').value='';
    if(!session.authenticated)throw new Error('로그인 정보를 확인해 주세요.');
    authenticated=true;sessionEpoch++;restoreActor();await refresh(true);
  }catch(error){showGate(error.message,true);$('loginPassword').focus();}
  finally{authenticating=false;$('loginButton').disabled=false;$('loginButton').textContent='로그인';}
}

async function logout(){
  if(savingProject||savingActivity||savingBudget){notice('저장이 끝난 뒤 로그아웃해 주세요.',true);return;}
  const dirty=editorDirty||activityDirty||budgetDirty;
  if(!confirm(dirty?'저장하지 않은 편집 내용이 있습니다. 저장하지 않고 로그아웃할까요?':'로그아웃할까요?'))return;
  showGate('로그아웃 중입니다.');authenticating=true;$('loginButton').disabled=true;
  try{await api('/api/auth',{method:'DELETE',body:'{}'});showGate('로그아웃했습니다.');}
  catch(error){showGate(`로그아웃 요청을 완료하지 못했습니다. ${error.message}`,true);}
  finally{authenticating=false;$('loginButton').disabled=false;}
}

async function exportBackup(){
  const button=$('exportBackup');button.disabled=true;
  try{
    const response=await fetch(apiUrl('/api/export'),{cache:'no-store',credentials:'same-origin'});
    if(!response.ok){const body=await response.json().catch(()=>({}));if(response.status===401)showGate('로그인이 만료되었습니다. 다시 로그인해 주세요.',true);throw new Error(body.message||'백업 데이터를 받지 못했습니다.');}
    if(!authenticated)return;
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`REDUCT_Project_Hub_Backup_${localDate()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notice('프로젝트 데이터 백업을 다운로드했습니다.');
  }catch(error){if(authenticated)notice(error.message,true);}
  finally{button.disabled=false;}
}

function actor(){return $('actorName').value.trim();}
function restoreActor(){try{$('actorName').value=localStorage.getItem('reductProjectHub.actor')||'';}catch{}}
function notice(message,error=false){const box=$('notice');box.className=`notice${error?' error':''}`;box.textContent=message;box.hidden=false;}
function clearNotice(){ $('notice').hidden=true; }
function fieldError(id,message){const box=$(id);box.textContent=message;box.hidden=!message;}
function statusLabel(p){return p.finalDone?'완료':STATUSES[p.status]||'현황미입력';}
function latestConflict(container,latest,kind){
  container.hidden=false;
  const summary=kind==='project'?`${latest.client} · ${statusLabel(latest)} · 담당자 ${latest.owner||'미지정'}`:`${latest.title} · ${latest.done?'완료':'진행중'}`;
  container.replaceChildren(document.createTextNode(`다른 담당자가 먼저 수정했습니다. 입력한 내용은 유지되어 있으며, 아직 저장되지 않았습니다.\n최신 내용: ${summary}\n최신 버전을 다시 열고 변경 사항을 확인한 뒤 저장해 주세요.`));
  const button=document.createElement('button');button.type='button';button.textContent='최신 버전으로 다시 열기';
  button.addEventListener('click',()=>{if(!confirm('현재 편집 내용은 저장되지 않습니다. 최신 버전으로 다시 열까요?'))return;if(kind==='project')openProject(latest.id,latest);else openActivity(latest.id,latest);});
  container.append(button);
}

async function refresh(force=false){
  if(!authenticated)return;
  if(refreshing){await refreshing;if(force)return refresh(false);return;}
  const epoch=sessionEpoch;
  refreshing=(async()=>{
    try{
      const next=await api('/api/state');
      if(!authenticated||epoch!==sessionEpoch)return;
      $('connectionState').textContent='공용 데이터 연결됨';$('connectionState').classList.remove('error');
      if(!state||next.revision>state.revision||force){
        if(state&&next.revision<state.revision)return;
        state=next;render();$('loginGate').hidden=true;$('projectApp').hidden=false;
      }
    }catch(error){
      if(error.status===401)return;
      if(!state){showGate(error.message,true);return;}
      $('connectionState').textContent='연결 확인 필요';$('connectionState').classList.add('error');
    }
  })();
  try{await refreshing;}finally{refreshing=null;}
}

function render(){
  if(!state)return;
  const updated=new Date(state.updatedAt);
  const updatedText=Number.isNaN(updated.getTime())?'':updated.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  $('revisionText').textContent=`공용 프로젝트 관리 · 수정 ${updatedText} · Rev. ${state.revision}`;
  $('storePath').textContent=state.storeInfo?.path?`공용 저장 위치 · ${state.storeInfo.path}`:'모든 담당자가 같은 공용 데이터로 작업합니다. 변경 사항은 자동으로 공유됩니다.';
  renderOverview();renderProjects();
}

function renderOverview(){
  const projects=activeProjects(),total=projects.length,done=projects.filter(p=>p.finalDone).length;
  const waiting=projects.filter(p=>!p.finalDone&&WAITING.has(p.status)).length;
  const progress=total-done-waiting;
  const known=projects.map(effectiveProgress).filter(p=>p!==null);
  const average=known.length?known.reduce((a,b)=>a+b,0)/known.length:null;
  const stats=[['전체 프로젝트',number(total),'건','보관 프로젝트 제외'],['진행중',number(progress),'건','재제작 포함'],['대기·검토',number(waiting),'건','견적·착수대기·보류 등'],['최종 완료',number(done),'건','최종 완료 체크 기준'],['전체 완료율',pct(total?done/total*100:0),'',`${done} / ${total}건 완료`],['입력 진척 평균',average===null?'—':pct(average),'',`진척 확인 ${known.length} / ${total}건`]];
  $('overviewStats').innerHTML=stats.map(([label,value,unit,note])=>`<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}${unit?`<small>${esc(unit)}</small>`:''}</div><div class="stat-note">${esc(note)}</div></div>`).join('');
  $('categoryCounts').innerHTML=Object.entries(CATEGORIES).map(([key,label])=>`<span>${esc(label)} <b>${projects.filter(p=>p.category===key).length}</b></span>`).join(' &nbsp;·&nbsp; ');
  const maxCount=Math.max(1,...Object.keys(CATEGORIES).map(key=>projects.filter(p=>p.category===key).length));
  $('categoryChart').innerHTML=Object.entries(CATEGORIES).map(([key,label])=>{
    const rows=projects.filter(p=>p.category===key),finished=rows.filter(p=>p.finalDone).length,standby=rows.filter(p=>!p.finalDone&&WAITING.has(p.status)).length,ongoing=rows.length-finished-standby;
    return `<div class="chart-row"><span>${esc(label)}</span><div class="bar-track" role="img" aria-label="${esc(label)} ${rows.length}건: 진행 ${ongoing}, 대기 ${standby}, 완료 ${finished}"><span class="bar-piece blue" style="width:${ongoing/maxCount*100}%"></span><span class="bar-piece gray" style="width:${standby/maxCount*100}%"></span><span class="bar-piece gold" style="width:${finished/maxCount*100}%"></span></div><span class="chart-number">${rows.length}</span></div>`;
  }).join('');
  const today=localDate(),offset=(new Date(`${today}T12:00:00Z`).getUTCDay()+6)%7,monday=addDays(today,-offset);
  const deadlineBuckets=[{label:'기한 경과',range:'미완료',count:0,overdue:true},...Array.from({length:4},(_,i)=>({label:i===0?'이번 주':i===1?'다음 주':`${i+1}주 차`,range:`${dateText(addDays(monday,i*7))}–${dateText(addDays(monday,i*7+6))}`,count:0})),{label:'이후·미정',range:'4주 이후 포함',count:0}];
  for(const project of projects.filter(p=>!p.finalDone)){
    if(!project.dueDate){deadlineBuckets[5].count++;continue;}
    if(project.dueDate<today){deadlineBuckets[0].count++;continue;}
    const week=Math.floor(dateDelta(project.dueDate,monday)/7);
    deadlineBuckets[week>=0&&week<4?week+1:5].count++;
  }
  const max=Math.max(1,...deadlineBuckets.map(b=>b.count));
  $('deadlineChart').innerHTML=deadlineBuckets.map(b=>`<div class="week-col"><div class="week-column-area"><div class="week-bar${b.overdue?' overdue':''}" style="height:${b.count/max*54}px" role="img" aria-label="${esc(b.label)} ${b.count}건"><b>${b.count}</b></div></div><span>${esc(b.label)}</span><small>${esc(b.range)}</small></div>`).join('');
}

function dueMarkup(p){
  if(p.finalDone)return `<div class="project-due finished">✓ 최종 완료<small>${p.finalDoneDate?esc(dateFull(p.finalDoneDate)):'완료일 미입력'}</small></div>`;
  const overdue=p.dueDate&&p.dueDate<localDate();
  let label=p.dueDate?dateText(p.dueDate):'일정 미정';
  if(p.dueDate&&p.windowStart&&p.windowStart!==p.dueDate)label=`${dateText(p.windowStart)}–${dateText(p.dueDate)}`;
  else if(p.dueDate)label+=' 이내';
  return `<div class="project-due${overdue?' overdue':''}">${esc(label)}<small>${overdue?'기한 경과 · 미완료':p.dueDate?(p.category==='manufacturing'?'입고 예정':'완료 예정'):'담당자 일정 입력'}</small></div>`;
}

function filteredProjects(){
  if(!state)return [];
  const query=$('searchInput').value.trim().toLocaleLowerCase(),category=$('categoryFilter').value,status=$('statusFilter').value,archive=$('showArchived').checked;
  return state.projects.filter(p=>Boolean(p.archived)===archive).filter(p=>category==='all'||p.category===category).filter(p=>status==='all'||(status==='done'?p.finalDone:status==='open'?!p.finalDone:!p.finalDone&&p.status===status)).filter(p=>!query||[p.client,p.task,p.owner,p.current,p.code].join(' ').toLocaleLowerCase().includes(query));
}

function setProjectView(view){
  projectView=view==='calendar'?'calendar':'list';
  try{localStorage.setItem('reductProjectHub.view',projectView);}catch{}
  syncProjectView();renderProjects();
  if(projectView==='calendar')$('calendarViewTab').closest('.project-view-bar').scrollIntoView({behavior:'smooth',block:'start'});
}

function syncProjectView(){
  for(const [view,tab,panel] of [['list','listViewTab','projectListPanel'],['calendar','calendarViewTab','calendarPanel']]){
    const selected=projectView===view;
    $(tab).setAttribute('aria-selected',String(selected));$(tab).tabIndex=selected?0:-1;$(panel).hidden=!selected;
  }
}

function renderProjectCalendar(projects){
  if(!window.ReductCalendar){$('projectCalendar').textContent='캘린더를 불러오지 못했습니다. 페이지를 새로고침해 주세요.';return;}
  const parentIds=new Set(projects.map(project=>project.id));
  window.ReductCalendar.render($('projectCalendar'),{
    projects,activities:(state.activities||[]).filter(activity=>parentIds.has(activity.projectId)),
    month:calendarMonth,selectedDate:calendarDate,today:localDate(),
    onMonthChange:month=>{if(!authenticated)return;calendarMonth=month;if(!calendarDate.startsWith(month))calendarDate=month===localDate().slice(0,7)?localDate():`${month}-01`;renderProjects();},
    onDateSelect:date=>{if(!authenticated)return;calendarDate=date;calendarMonth=date.slice(0,7);renderProjects();},
    onOpenProject:id=>{if(authenticated&&state.projects.some(project=>project.id===id))openProject(id);},
    onOpenActivity:id=>{if(authenticated&&state.activities.some(activity=>activity.id===id))openActivity(id);}
  });
}

function renderProjects(){
  if(!state)return;
  const projects=filteredProjects();
  const category=$('categoryFilter').value,archive=$('showArchived').checked;
  syncProjectView();
  if(projectView==='calendar'){renderProjectCalendar(projects);return;}
  const html=[];
  if(archive)html.push('<div class="notice">보관함입니다. 보관된 프로젝트는 전체 현황에서 제외됩니다. 상세 내용을 열어 다시 복원할 수 있습니다.</div>');
  for(const [key,label] of Object.entries(CATEGORIES)){
    if(category!=='all'&&category!==key)continue;
    const rows=projects.filter(p=>p.category===key);
    const headers=DEFAULT_STAGES[key];
    let quantity='';
    for(const project of rows.filter(p=>isKnown(p.quantityTotal)&&Number(p.quantityTotal)>0&&isKnown(p.quantityDone))){
      const percentage=Number(project.quantityDone)/Number(project.quantityTotal)*100;
      quantity+=`<div class="quantity-highlight"><h3>수량 완료율</h3><div class="quantity-bar-wrap"><div class="quantity-line"><span>${esc(project.client)} 수량 완료율</span><span>${number(project.quantityDone)} / ${number(project.quantityTotal)}개 · ${pct(percentage)}</span></div><div class="quantity-bar" role="img" aria-label="${esc(project.client)} 수량 완료율 ${pct(percentage)}"><span style="width:${Math.max(0,Math.min(100,percentage))}%"></span></div></div></div>`;
    }
    html.push(`<section class="category-section" aria-labelledby="category-${key}"><div class="category-title"><h2 id="category-${key}">${esc(label)}</h2><span>${rows.length}건</span></div>${quantity}<div class="list-head"><span>프로젝트 · 현재 상태</span><div class="stage-head">${headers.map(h=>`<span>${esc(h)}</span>`).join('')}</div><span class="due-head">입고·완료 일정</span></div>${rows.length?rows.map(projectMarkup).join(''):'<p class="category-empty">표시할 프로젝트가 없습니다.</p>'}</section>`);
  }
  $('projectList').innerHTML=html.join('');
}

function projectMarkup(p){
  const open=expanded.has(p.id),progress=effectiveProgress(p),tag=p.finalDone||p.status!=='in_progress';
  const stages=(p.stages||[]).slice(0,4).map(stage=>({...stage}));
  while(stages.length<4)stages.push({label:DEFAULT_STAGES[p.category]?.[stages.length]||'단계',state:'unknown'});
  if(p.category==='manufacturing'&&p.productionDone===true)stages[2].state='done';
  if(p.category==='manufacturing'&&p.receiptDone===true)stages[3].state='done';
  if(p.finalDone)stages[3].state='done';
  return `<article class="project${p.archived?' is-archived':''}" data-project="${esc(p.id)}"><div class="project-summary"><button type="button" class="project-main" data-expand="${esc(p.id)}" aria-expanded="${open}" aria-controls="details-${esc(p.id)}"><div class="project-name"><span class="expand-sign" aria-hidden="true">${open?'−':'＋'}</span><span class="project-client">${esc(p.client||'프로젝트명 미입력')}</span>${tag?`<span class="status-tag ${p.finalDone?'done':p.status==='rework'?'rework':''}">${esc(statusLabel(p))}</span>`:''}</div><div class="project-task">${esc(p.task)}</div>${p.current?`<div class="project-current">${esc(p.current)}</div>`:''}${p.owner?`<div class="row-owner">담당 ${esc(p.owner)}</div>`:''}${progress!==null?`<div class="row-progress"><div class="thin-track"><span style="width:${progress}%"></span></div><span>${pct(progress)}</span></div>`:''}</button><div class="project-stages">${stages.map(stage=>`<button type="button" class="stage-cell ${esc(stage.state)}" data-edit="${esc(p.id)}" data-label="${esc(stage.label)}" title="${esc(stage.label)}: ${esc(STAGE_STATES[stage.state]||'미확인')} · 눌러서 수정" aria-label="${esc(p.client)} ${esc(stage.label)} ${esc(STAGE_STATES[stage.state]||'미확인')}, 수정">${stage.state==='unknown'?'·':stage.state==='done'?'✓':esc(STAGE_STATES[stage.state]||'·')}</button>`).join('')}</div>${dueMarkup(p)}</div>${open?detailsMarkup(p):''}</article>`;
}

function detailsMarkup(p){
  const progress=effectiveProgress(p);
  const fields=[['담당자',p.owner||'미지정'],['현재 상태',statusLabel(p)],['작업 진척률',progress===null?'미입력':pct(progress)],['제작 완료 예정',dateFull(p.productionDue)],['입고·완료 시작일',dateFull(p.windowStart)],['입고·최종 완료 예정',dateFull(p.dueDate)]];
  return `<div class="project-details" id="details-${esc(p.id)}"><div class="detail-grid">${fields.map(([title,value])=>`<dl><dt>${esc(title)}</dt><dd>${esc(value)}</dd></dl>`).join('')}<dl class="detail-wide"><dt>현재 진행 내용</dt><dd>${esc(p.current||'입력된 내용이 없습니다.')}</dd></dl></div><div class="quick-checks">${[['productionDone','productionDoneDate','제작 완료'],['receiptDone','receiptDoneDate','입고 완료'],['finalDone','finalDoneDate','프로젝트 최종 완료']].map(([field,date,title])=>`<label class="checkbox-label"><input type="checkbox" data-check="${field}" data-id="${esc(p.id)}" ${p[field]?'checked':''} ${pending.has(p.id)?'disabled':''}>${esc(title)}<small>${p[field]?esc(p[date]?dateFull(p[date]):'완료일 미입력'):p[field]===null?'해당 없음':''}</small></label>`).join('')}</div>${p.category==='internal'?internalMarkup(p):''}${p.source?`<details class="detail-source"><summary>원본 등록 내용</summary><p>${esc(p.source)}</p></details>`:''}<div class="detail-actions"><button type="button" data-edit="${esc(p.id)}">일정·담당자·진척 수정</button><span class="subtitle">${esc(p.code||'')} · 수정 ${esc(p.updatedAt?dateFull(p.updatedAt.slice(0,10)):'미상')}</span><button type="button" class="archive-button" data-archive="${esc(p.id)}" ${pending.has(p.id)?'disabled':''}>${p.archived?'보관 해제':'프로젝트 보관'}</button></div></div>`;
}

function internalMarkup(p){
  const activities=(state.activities||[]).filter(a=>a.projectId===p.id);
  const budget=state.budget?.projectId===p.id?state.budget:null;
  if(!activities.length&&!budget)return '';
  const rows=activities.map(a=>`<div class="activity-row"><input type="checkbox" class="activity-check" data-activity-check="${esc(a.id)}" aria-label="${esc(a.title)} 완료" ${a.done?'checked':''} ${pending.has(a.id)?'disabled':''}><div class="activity-title">${esc(a.title)}${a.current?`<small>${esc(a.current)}</small>`:''}${a.notes?`<small>${esc(a.notes)}</small>`:''}${a.startTime?`<small>${esc(a.startTime)}${a.durationMinutes!==null&&a.durationMinutes!==undefined?` · 약 ${number(a.durationMinutes)}분`:''}${a.owner?` · 담당 ${esc(a.owner)}`:''}</small>`:a.owner?`<small>담당 ${esc(a.owner)}</small>`:''}</div><div class="activity-date">${a.done?'✓ 완료':'예정'}<br>${esc(dateFull(a.done?a.doneDate:a.dueDate))}</div><button type="button" data-activity-edit="${esc(a.id)}">수정</button></div>`).join('');
  return `<div class="internal-activities"><h3>내부 프로젝트 활동·주요 일정</h3>${rows}${budget?`<div class="budget-line"><span>전체 활동비 <strong>${number(budget.total)}원</strong></span><span class="budget-used">사용 <strong>${number(budget.spent)}원</strong></span><span>잔액 ${number(budget.total-budget.spent)}원</span><button type="button" data-budget-edit>활동비 수정</button></div>`:''}</div>`;
}

function defaultProject(){return {id:null,category:'manufacturing',client:'',task:'',owner:'',status:'in_progress',progress:null,productionDue:null,windowStart:null,dueDate:null,productionDone:false,receiptDone:false,finalDone:false,productionDoneDate:null,receiptDoneDate:null,finalDoneDate:null,current:'',quantityDone:null,quantityTotal:null,stages:DEFAULT_STAGES.manufacturing.map(label=>({label,state:'unknown'}))};}
function setFormValue(form,name,value){const input=form.elements.namedItem(name);if(!input)return;if(input.type==='checkbox')input.checked=Boolean(value);else input.value=value??'';}
function buildStageEditor(stages){$('stageEditor').innerHTML=stages.map((stage,index)=>`<label><span class="sr-only">${index+1}단계 이름</span><input name="stageLabel${index}" value="${esc(stage.label)}" maxlength="40" required aria-label="${index+1}단계 이름"><select name="stageState${index}" aria-label="${index+1}단계 상태">${Object.entries(STAGE_STATES).map(([key,label])=>`<option value="${key}"${key===stage.state?' selected':''}>${label}</option>`).join('')}</select></label>`).join('');}
function openProject(id,latest=null){
  const project=latest||state?.projects.find(p=>p.id===id)||defaultProject();
  editorBase=structuredClone(project);newProjectRequestId=project.id?null:crypto.randomUUID();editorDirty=false;
  $('projectDialogTitle').textContent=project.id?'프로젝트 수정':'프로젝트 추가';
  const form=$('projectForm');form.reset();
  for(const [key,value] of Object.entries(project))setFormValue(form,key,value);
  buildStageEditor(project.stages?.length===4?project.stages:DEFAULT_STAGES[project.category].map(label=>({label,state:'unknown'})));
  fieldError('projectFormError','');$('projectConflict').hidden=true;
  if(!$('projectDialog').open)$('projectDialog').showModal();
}
function numOrNull(form,name){const text=form.elements.namedItem(name).value.trim();return text===''?null:Number(text);}
function readProject(){
  const form=$('projectForm'),result={};
  for(const name of ['category','client','task','owner','status','current'])result[name]=form.elements.namedItem(name).value.trim();
  for(const name of ['productionDue','windowStart','dueDate','productionDoneDate','receiptDoneDate','finalDoneDate'])result[name]=form.elements.namedItem(name).value||null;
  for(const name of ['progress','quantityDone','quantityTotal'])result[name]=numOrNull(form,name);
  for(const name of ['productionDone','receiptDone','finalDone'])result[name]=form.elements.namedItem(name).checked?true:(editorBase[name]===null?null:false);
  result.stages=Array.from({length:4},(_,index)=>({label:form.elements.namedItem(`stageLabel${index}`).value.trim(),state:form.elements.namedItem(`stageState${index}`).value}));
  return result;
}
function narrowChanges(base,next){return Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(base[key])!==JSON.stringify(value)));}
function validateProject(values){
  if(values.windowStart&&values.dueDate&&values.windowStart>values.dueDate)return '입고·완료 시작일은 최종 예정일 이전으로 입력해 주세요.';
  if(values.quantityDone!==null&&values.quantityTotal!==null&&values.quantityDone>values.quantityTotal)return '완료 수량이 전체 수량보다 큽니다. 수량을 확인해 주세요.';
  return '';
}
async function saveProject(event){
  event.preventDefault();if(savingProject)return;
  const values=readProject(),validation=validateProject(values);if(validation){fieldError('projectFormError',validation);return;}
  const changes=narrowChanges(editorBase,values);
  if(editorBase.id&&!Object.keys(changes).length){$('projectDialog').close();return;}
  savingProject=true;$('saveProject').disabled=true;$('saveProject').textContent='저장 중…';fieldError('projectFormError','');
  try{
    if(editorBase.id)await api(`/api/projects/${encodeURIComponent(editorBase.id)}`,{method:'PATCH',body:JSON.stringify({version:editorBase.version,changes,actor:actor()})});
    else await api('/api/projects',{method:'POST',body:JSON.stringify({project:values,actor:actor(),requestId:newProjectRequestId})});
    newProjectRequestId=null;editorDirty=false;$('projectDialog').close();await refresh(true);notice('프로젝트를 공용 데이터에 저장했습니다.');
  }catch(error){if(error.status===409&&error.body?.latest){latestConflict($('projectConflict'),error.body.latest,'project');await refresh(true);}else fieldError('projectFormError',error.message);}
  finally{savingProject=false;$('saveProject').disabled=false;$('saveProject').textContent='저장';}
}

async function quickProject(id,changes){
  if(pending.has(id))return;
  const project=state.projects.find(p=>p.id===id);if(!project)return;
  pending.add(id);renderProjects();
  try{await api(`/api/projects/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({version:project.version,changes,actor:actor()})});await refresh(true);notice('변경 사항을 저장했습니다.');}
  catch(error){if(error.status===409){notice('다른 담당자가 먼저 수정하여 저장하지 않았습니다. 최신 내용을 불러왔습니다. 확인 후 다시 변경해 주세요.',true);await refresh(true);}else notice(error.message,true);}
  finally{pending.delete(id);renderProjects();}
}

function openActivity(id,latest=null){
  const activity=latest||state.activities.find(a=>a.id===id);if(!activity)return;
  activityBase=structuredClone(activity);activityDirty=false;const form=$('activityForm');form.reset();for(const [key,value] of Object.entries(activity))setFormValue(form,key,value);fieldError('activityFormError','');$('activityConflict').hidden=true;if(!$('activityDialog').open)$('activityDialog').showModal();
}
async function saveActivity(event){
  event.preventDefault();if(savingActivity)return;
  const form=$('activityForm'),values={};
  for(const name of ['title','owner','current','notes'])values[name]=form.elements.namedItem(name).value.trim();
  for(const name of ['dueDate','doneDate','startTime'])values[name]=form.elements.namedItem(name).value||null;
  values.done=form.elements.namedItem('done').checked;values.durationMinutes=numOrNull(form,'durationMinutes');
  const changes=narrowChanges(activityBase,values);if(!Object.keys(changes).length){$('activityDialog').close();return;}
  savingActivity=true;$('saveActivity').disabled=true;fieldError('activityFormError','');
  try{await api(`/api/activities/${encodeURIComponent(activityBase.id)}`,{method:'PATCH',body:JSON.stringify({version:activityBase.version,changes,actor:actor()})});activityDirty=false;$('activityDialog').close();await refresh(true);notice('활동 내역을 저장했습니다.');}
  catch(error){if(error.status===409&&error.body?.latest){latestConflict($('activityConflict'),error.body.latest,'activity');await refresh(true);}else fieldError('activityFormError',error.message);}
  finally{savingActivity=false;$('saveActivity').disabled=false;}
}
async function quickActivity(id,done){
  const activity=state.activities.find(a=>a.id===id);if(!activity||pending.has(id))return;
  pending.add(id);renderProjects();
  try{await api(`/api/activities/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({version:activity.version,changes:{done,...(done&&!activity.doneDate?{doneDate:localDate()}:{})},actor:actor()})});await refresh(true);notice('활동 완료 상태를 저장했습니다.');}
  catch(error){if(error.status===409){notice('다른 담당자가 활동을 먼저 수정했습니다. 최신 내용을 확인 후 다시 변경해 주세요.',true);await refresh(true);}else notice(error.message,true);}
  finally{pending.delete(id);renderProjects();}
}
function openBudget(){
  budgetBase=structuredClone(state.budget);budgetDirty=false;setFormValue($('budgetForm'),'total',budgetBase.total);setFormValue($('budgetForm'),'spent',budgetBase.spent);fieldError('budgetFormError','');$('budgetDialog').showModal();
}
async function saveBudget(event){
  event.preventDefault();if(savingBudget)return;const form=$('budgetForm'),values={total:Number(form.elements.namedItem('total').value),spent:Number(form.elements.namedItem('spent').value)},changes=narrowChanges(budgetBase,values);if(!Object.keys(changes).length){$('budgetDialog').close();return;}
  savingBudget=true;$('saveBudget').disabled=true;fieldError('budgetFormError','');
  try{await api('/api/budget',{method:'PATCH',body:JSON.stringify({version:budgetBase.version,changes,actor:actor()})});budgetDirty=false;$('budgetDialog').close();await refresh(true);notice('활동비를 저장했습니다.');}
  catch(error){if(error.status===409){fieldError('budgetFormError','다른 담당자가 활동비를 먼저 수정했습니다. 입력한 내용은 저장되지 않았습니다. 이 창을 닫고 최신 활동비를 다시 확인해 주세요.');await refresh(true);}else fieldError('budgetFormError',error.message);}
  finally{savingBudget=false;$('saveBudget').disabled=false;}
}

function closeDialog(id){
  const dirty=id==='projectDialog'?editorDirty:id==='activityDialog'?activityDirty:budgetDirty;
  const saving=id==='projectDialog'?savingProject:id==='activityDialog'?savingActivity:savingBudget;
  if(saving)return;
  if(dirty&&!confirm('저장하지 않은 내용이 있습니다. 편집을 닫을까요?'))return;
  if(id==='projectDialog')newProjectRequestId=null;
  $(id).close();
}
function setup(){
  try{projectView=localStorage.getItem('reductProjectHub.view')==='calendar'?'calendar':'list';}catch{}
  syncProjectView();
  for(const [view,id] of [['list','listViewTab'],['calendar','calendarViewTab']]){
    $(id).addEventListener('click',()=>setProjectView(view));
    $(id).addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const target=event.key==='Home'?'list':event.key==='End'?'calendar':view==='list'?'calendar':'list';
      setProjectView(target);$(target==='list'?'listViewTab':'calendarViewTab').focus();
    });
  }
  $('categoryFilter').insertAdjacentHTML('beforeend',Object.entries(CATEGORIES).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join(''));
  $('projectForm').elements.namedItem('category').innerHTML=Object.entries(CATEGORIES).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('');
  $('projectForm').elements.namedItem('status').innerHTML=Object.entries(STATUSES).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('');
  $('actorName').addEventListener('change',()=>{try{localStorage.setItem('reductProjectHub.actor',actor());}catch{}});
  $('addProject').addEventListener('click',()=>{if(!state){notice('데이터 연결 후 프로젝트를 추가할 수 있습니다.',true);return;}openProject(null);});
  $('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderProjects,150);});
  for(const id of ['categoryFilter','statusFilter','showArchived'])$(id).addEventListener('change',renderProjects);
  $('projectList').addEventListener('click',event=>{
    const expand=event.target.closest('[data-expand]');if(expand){const id=expand.dataset.expand;expanded.has(id)?expanded.delete(id):expanded.add(id);renderProjects();return;}
    const edit=event.target.closest('[data-edit]');if(edit){openProject(edit.dataset.edit);return;}
    const archive=event.target.closest('[data-archive]');if(archive){const project=state.projects.find(p=>p.id===archive.dataset.archive);if(project&&confirm(project.archived?'이 프로젝트의 보관을 해제할까요?':'이 프로젝트를 보관할까요? 전체 현황에서 제외되며, 보관함에서 복원할 수 있습니다.'))quickProject(project.id,{archived:!project.archived});return;}
    const activity=event.target.closest('[data-activity-edit]');if(activity){openActivity(activity.dataset.activityEdit);return;}
    if(event.target.closest('[data-budget-edit]'))openBudget();
  });
  $('projectList').addEventListener('change',event=>{
    const input=event.target;
    if(input.dataset.check){const p=state.projects.find(p=>p.id===input.dataset.id);if(!p)return;const field=input.dataset.check,dateField=field==='productionDone'?'productionDoneDate':field==='receiptDone'?'receiptDoneDate':'finalDoneDate';const changes={[field]:input.checked};if(input.checked&&!p[dateField])changes[dateField]=localDate();quickProject(p.id,changes);}
    else if(input.dataset.activityCheck)quickActivity(input.dataset.activityCheck,input.checked);
  });
  $('projectForm').addEventListener('input',()=>{editorDirty=true;});$('projectForm').addEventListener('change',()=>{editorDirty=true;});
  $('activityForm').addEventListener('input',()=>{activityDirty=true;});$('activityForm').addEventListener('change',()=>{activityDirty=true;});
  $('budgetForm').addEventListener('input',()=>{budgetDirty=true;});
  $('projectForm').elements.namedItem('category').addEventListener('change',event=>{if(editorBase?.id)return;const current=Array.from($('stageEditor').querySelectorAll('select')).map(s=>s.value);buildStageEditor(DEFAULT_STAGES[event.target.value].map((label,i)=>({label,state:current[i]||'unknown'})));});
  for(const [flag,dateField] of [['productionDone','productionDoneDate'],['receiptDone','receiptDoneDate'],['finalDone','finalDoneDate']])$('projectForm').elements.namedItem(flag).addEventListener('change',event=>{if(event.target.checked&&!$('projectForm').elements.namedItem(dateField).value)$('projectForm').elements.namedItem(dateField).value=localDate();});
  $('activityForm').elements.namedItem('done').addEventListener('change',event=>{if(event.target.checked&&!$('activityForm').elements.namedItem('doneDate').value)$('activityForm').elements.namedItem('doneDate').value=localDate();});
  $('projectForm').addEventListener('submit',saveProject);$('activityForm').addEventListener('submit',saveActivity);$('budgetForm').addEventListener('submit',saveBudget);
  for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>closeDialog(button.dataset.close));
  for(const id of ['projectDialog','activityDialog','budgetDialog'])$(id).addEventListener('cancel',event=>{event.preventDefault();closeDialog(id);});
  $('loginForm').addEventListener('submit',login);
  $('logoutButton').addEventListener('click',logout);
  $('exportBackup').addEventListener('click',exportBackup);
  window.addEventListener('beforeunload',event=>{if(($('projectDialog').open&&editorDirty)||($('activityDialog').open&&activityDirty)||($('budgetDialog').open&&budgetDirty)){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>showGate('접속 권한을 다시 확인해 주세요.'));
  window.addEventListener('pageshow',event=>{if(event.persisted)checkSession();});
  checkSession();setInterval(()=>{if(authenticated&&!document.hidden)refresh();},15000);document.addEventListener('visibilitychange',()=>{if(authenticated&&!document.hidden)refresh();});
}
setup();
