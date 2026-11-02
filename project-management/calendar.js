(function(global){
  'use strict';

  const CATEGORIES={manufacturing:'제조',onestop:'원스톱 서비스',circuit:'회로개발',structure:'구조설계',internal:'내부 프로젝트'};
  const WEEKDAYS=['일','월','화','수','목','금','토'];
  const TYPE_ORDER={production:0,deadline:1,activity:2};
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text=value=>typeof value==='string'?value:'';

  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const parsed=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  }
  function validMonth(value){return typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&validDate(`${value}-01`);}
  function addDays(date,days){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
  function shiftMonth(month,offset){const value=new Date(`${month}-01T00:00:00Z`);value.setUTCMonth(value.getUTCMonth()+offset);return value.toISOString().slice(0,7);}
  function shortDate(date){return `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;}
  function fullDate(date){return date.replaceAll('-','.');}
  function koreanDay(date){return `${Number(date.slice(5,7))}월 ${Number(date.slice(8,10))}일 (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;}
  function categoryKey(category){return Object.prototype.hasOwnProperty.call(CATEGORIES,category)?category:'other';}

  /** Normalize supplied records without mutating them or expanding date ranges. */
  function buildEvents(projects=[],activities=[]){
    const projectRows=Array.isArray(projects)?projects.filter(p=>p&&typeof p.id==='string'&&p.id):[];
    const projectMap=new Map(projectRows.map(p=>[p.id,p]));
    const events=[];
    function projectEvent(project,type,stageLabel,plannedDate,done,actualDate,windowStart){
      const planned=validDate(plannedDate)?plannedDate:null;
      const actual=validDate(actualDate)?actualDate:null;
      const startWindow=validDate(windowStart)?windowStart:null;
      const anchor=planned||startWindow||(done&&actual?actual:null);
      if(!anchor)return;
      const start=planned&&startWindow&&startWindow<=planned?startWindow:anchor;
      events.push({id:`${type}:${project.id}`,type,projectId:project.id,activityId:null,
        category:categoryKey(project.category),client:text(project.client),task:text(project.task),
        title:text(project.client)||text(project.task)||'프로젝트',owner:text(project.owner),
        stageLabel,startDate:start,endDate:anchor,date:anchor,done:done===true,doneDate:actual,
        isRange:start!==anchor,actualOnly:!planned&&!startWindow,missingEnd:!planned&&Boolean(startWindow),
        current:text(project.current)});
    }
    for(const project of projectRows){
      projectEvent(project,'production','제작 완료',project.productionDue,project.productionDone===true,project.productionDoneDate,null);
      const manufacturing=project.category==='manufacturing';
      const finalOnly=manufacturing&&!validDate(project.dueDate)&&!validDate(project.windowStart)
        &&!(project.receiptDone===true&&validDate(project.receiptDoneDate))
        &&project.finalDone===true&&validDate(project.finalDoneDate);
      if(finalOnly)projectEvent(project,'deadline','최종 완료',null,true,project.finalDoneDate,null);
      else projectEvent(project,'deadline',manufacturing?'입고':'최종 완료',project.dueDate,
          manufacturing?project.receiptDone===true:project.finalDone===true,
          manufacturing?project.receiptDoneDate:project.finalDoneDate,project.windowStart);
    }
    for(const activity of Array.isArray(activities)?activities:[]){
      if(!activity||typeof activity.id!=='string')continue;
      const project=projectMap.get(activity.projectId);
      if(!project)continue;
      const planned=validDate(activity.dueDate)?activity.dueDate:null;
      const actual=validDate(activity.doneDate)?activity.doneDate:null;
      const anchor=planned||(activity.done===true&&actual?actual:null);
      if(!anchor)continue;
      events.push({id:`activity:${activity.id}`,type:'activity',projectId:project.id,activityId:activity.id,
        category:categoryKey(project.category),client:text(project.client),task:text(project.task),
        title:text(activity.title)||'프로젝트 활동',owner:text(activity.owner)||text(project.owner),
        stageLabel:'활동',startDate:anchor,endDate:anchor,date:anchor,done:activity.done===true,doneDate:actual,
        isRange:false,actualOnly:!planned,missingEnd:false,current:text(activity.current),
        startTime:text(activity.startTime),durationMinutes:activity.durationMinutes??null});
    }
    return events.sort((a,b)=>a.startDate.localeCompare(b.startDate)||TYPE_ORDER[a.type]-TYPE_ORDER[b.type]||a.title.localeCompare(b.title,'ko')||a.id.localeCompare(b.id));
  }

  /** A range matches its start and end dates inclusively; no daily records are stored. */
  function getEventsForDate(events,date){
    if(!Array.isArray(events)||!validDate(date))return [];
    return events.filter(event=>event&&validDate(event.startDate)&&validDate(event.endDate)&&event.startDate<=date&&date<=event.endDate);
  }

  function eventTypeLabel(event){return event.type==='production'?'제작':event.type==='activity'?'활동':event.stageLabel==='입고'?'입고':'완료';}
  function rangeText(event){
    if(event.actualOnly)return `실제 완료 ${fullDate(event.endDate)}`;
    if(event.missingEnd)return `${fullDate(event.startDate)}부터 · 종료일 미정`;
    return event.isRange?`${fullDate(event.startDate)} – ${fullDate(event.endDate)}`:fullDate(event.endDate);
  }
  function eventDescription(event){
    const completed=event.done?`완료 · ${event.doneDate?`실제 완료일 ${fullDate(event.doneDate)}`:'완료일 미입력'}`:'미완료';
    return `${event.stageLabel} · ${event.title} · ${rangeText(event)} · ${completed}`;
  }
  function eventPill(event,date,index){
    const rangeClass=event.isRange?(date===event.startDate?' rc-range-start':date===event.endDate?' rc-range-end':' rc-range-middle'):'';
    const prefix=event.done?'✓ ':event.isRange&&date!==event.startDate?'↔ ':'';
    return `<button type="button" class="rc-event rc-category-${event.category}${event.done?' rc-event-done':''}${rangeClass}" data-rc-event="${index}" title="${escapeHTML(eventDescription(event))}" aria-label="${escapeHTML(eventDescription(event))}"><span class="rc-event-type">${escapeHTML(prefix+eventTypeLabel(event))}</span><span class="rc-event-name">${escapeHTML(event.title)}</span></button>`;
  }
  function agendaMarkup(events,selectedDate,today){
    const selected=getEventsForDate(events,selectedDate);
    return `<section class="rc-agenda" aria-labelledby="rc-agenda-title"><header class="rc-agenda-header"><h3 id="rc-agenda-title">${escapeHTML(koreanDay(selectedDate))}${selectedDate===today?' <span class="rc-today-label">오늘</span>':''}</h3><span>${selected.length}건의 일정</span></header>${selected.length?selected.map(event=>{
      const overdue=!event.done&&!event.missingEnd&&event.endDate<today;
      const eventIndex=events.indexOf(event);
      return `<button type="button" class="rc-agenda-item rc-category-${event.category}" data-rc-event="${eventIndex}" aria-label="${escapeHTML(eventDescription(event))}, 수정 화면 열기"><span class="rc-agenda-meta"><span>${escapeHTML(CATEGORIES[event.category]||'프로젝트')} · ${escapeHTML(event.stageLabel)}</span><span class="rc-agenda-status${event.done?' is-done':overdue?' is-overdue':''}">${event.done?'✓ 완료':overdue?'기한 경과':'예정'}</span></span><strong>${escapeHTML(event.title)}</strong>${event.type==='activity'?`<span class="rc-agenda-task">${escapeHTML(event.client)}</span>`:event.task?`<span class="rc-agenda-task">${escapeHTML(event.task)}</span>`:''}<span class="rc-agenda-date">${event.actualOnly?'':'예정 '}${escapeHTML(rangeText(event))}</span>${event.done?`<span class="rc-agenda-actual">${event.doneDate?`실제 완료일 ${escapeHTML(fullDate(event.doneDate))}`:'완료일 미입력'}</span>`:''}${event.startTime?`<span class="rc-agenda-date">${escapeHTML(event.startTime)}${Number.isFinite(event.durationMinutes)?` · 약 ${event.durationMinutes}분`:''}</span>`:''}${event.owner?`<span class="rc-agenda-owner">담당 ${escapeHTML(event.owner)}</span>`:''}</button>`;
    }).join(''):'<p class="rc-empty">선택한 날짜에 등록된 일정이 없습니다.</p>'}</section>`;
  }

  function render(container,options={}){
    if(!container||typeof container.replaceChildren!=='function')return;
    const today=validDate(options.today)?options.today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const month=validMonth(options.month)?options.month:today.slice(0,7);
    const selectedDate=validDate(options.selectedDate)?options.selectedDate:today;
    const projects=Array.isArray(options.projects)?options.projects.filter(p=>p&&typeof p.id==='string'&&p.id):[];
    const events=buildEvents(projects,options.activities);
    const first=`${month}-01`,nextMonth=shiftMonth(month,1),last=addDays(`${nextMonth}-01`,-1);
    const gridStart=addDays(first,-new Date(`${first}T00:00:00Z`).getUTCDay());
    const monthEvents=events.filter(event=>event.startDate<=last&&event.endDate>=first);
    const ownScheduled=new Set(events.filter(event=>event.type!=='activity').map(event=>event.projectId));
    const undated=projects.filter(project=>!ownScheduled.has(project.id));
    const visibleCategories=Object.keys(CATEGORIES).filter(category=>projects.some(project=>project.category===category));
    const days=Array.from({length:42},(_,index)=>{
      const date=addDays(gridStart,index),dayEvents=getEventsForDate(events,date),outside=date.slice(0,7)!==month;
      const day=new Date(`${date}T00:00:00Z`).getUTCDay();
      return `<div class="rc-day${outside?' rc-day-outside':''}${date===today?' rc-day-today':''}${date===selectedDate?' rc-day-selected':''}${day===0?' rc-sunday':day===6?' rc-saturday':''}"><button type="button" class="rc-date-button" data-rc-date="${date}" aria-label="${Number(date.slice(0,4))}년 ${escapeHTML(koreanDay(date))} ${dayEvents.length}건의 일정${date===today?', 오늘':''}" aria-pressed="${date===selectedDate}"><span>${Number(date.slice(8,10))}</span>${dayEvents.length?`<small>${dayEvents.length}건</small>`:''}</button><div class="rc-day-events">${dayEvents.slice(0,3).map(event=>eventPill(event,date,events.indexOf(event))).join('')}${dayEvents.length>3?`<button type="button" class="rc-more" data-rc-date="${date}" aria-label="${escapeHTML(koreanDay(date))} 일정 ${dayEvents.length}건 모두 보기">＋ ${dayEvents.length-3}개 더</button>`:''}</div></div>`;
    }).join('');
    container.innerHTML=`<section class="rc-calendar" aria-label="프로젝트 일정 달력"><header class="rc-toolbar"><div><h2>${Number(month.slice(0,4))}년 ${Number(month.slice(5,7))}월</h2><p>일정 ${monthEvents.length}건 <span>· 완료 확인 ${monthEvents.filter(event=>event.done).length}건</span></p></div><div class="rc-navigation"><button type="button" data-rc-nav="prev" aria-label="이전 달">‹</button><button type="button" data-rc-nav="today">오늘</button><button type="button" data-rc-nav="next" aria-label="다음 달">›</button></div></header><p class="rc-plan-note">예정일 기준 · 실제 완료일은 일정 상세에서 확인</p><div class="rc-category-legend" aria-label="분야별 색상">${visibleCategories.map(category=>`<span class="rc-category-${category}"><i></i>${escapeHTML(CATEGORIES[category])}</span>`).join('')}<span class="rc-type-legend">제작 · 입고/완료 · 활동 &nbsp; / &nbsp; ✓ 완료 확인</span></div><div class="rc-layout"><div class="rc-month"><p class="rc-mobile-hint">날짜를 누르면 일정을 모아볼 수 있습니다. 작은 화면에서는 달력을 옆으로 밀어 보세요.</p><div class="rc-grid-scroll"><div class="rc-grid"><div class="rc-weekdays">${WEEKDAYS.map((name,index)=>`<span class="${index===0?'rc-sunday':index===6?'rc-saturday':''}">${name}</span>`).join('')}</div><div class="rc-days">${days}</div></div></div></div>${agendaMarkup(events,selectedDate,today)}</div><section class="rc-undated" aria-labelledby="rc-undated-title"><header><h3 id="rc-undated-title">일정 미입력 프로젝트 <span>${undated.length}건</span></h3><p>프로젝트를 눌러 제작·입고·최종 완료 예정일을 입력할 수 있습니다.</p></header>${undated.length?`<div class="rc-undated-list">${undated.map((project,index)=>`<button type="button" class="rc-undated-item rc-category-${categoryKey(project.category)}" data-rc-undated="${index}"><span>${escapeHTML(CATEGORIES[project.category]||'프로젝트')}</span><strong>${escapeHTML(project.client||project.task||'프로젝트')}</strong>${project.task?`<small>${escapeHTML(project.task)}</small>`:''}</button>`).join('')}</div>`:'<p class="rc-empty">모든 프로젝트에 일정이 입력되어 있습니다.</p>'}</section></section>`;
    for(const button of container.querySelectorAll('[data-rc-nav]'))button.addEventListener('click',()=>{
      const action=button.dataset.rcNav;
      if(action==='today'){
        if(typeof options.onMonthChange==='function')options.onMonthChange(today.slice(0,7));
        if(typeof options.onDateSelect==='function')options.onDateSelect(today);
      }else if(typeof options.onMonthChange==='function')options.onMonthChange(shiftMonth(month,action==='prev'?-1:1));
    });
    for(const button of container.querySelectorAll('[data-rc-date]'))button.addEventListener('click',()=>{
      const date=button.dataset.rcDate;
      if(date.slice(0,7)!==month&&typeof options.onMonthChange==='function')options.onMonthChange(date.slice(0,7));
      if(typeof options.onDateSelect==='function')options.onDateSelect(date);
    });
    for(const button of container.querySelectorAll('[data-rc-event]'))button.addEventListener('click',()=>{
      const event=events[Number(button.dataset.rcEvent)];if(!event)return;
      if(event.type==='activity'&&typeof options.onOpenActivity==='function')options.onOpenActivity(event.activityId);
      else if(typeof options.onOpenProject==='function')options.onOpenProject(event.projectId);
    });
    for(const button of container.querySelectorAll('[data-rc-undated]'))button.addEventListener('click',()=>{
      const project=undated[Number(button.dataset.rcUndated)];if(project&&typeof options.onOpenProject==='function')options.onOpenProject(project.id);
    });
  }

  global.ReductCalendar=Object.freeze({buildEvents,getEventsForDate,render});
})(typeof window!=='undefined'?window:globalThis);
