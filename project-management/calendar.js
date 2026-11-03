(function(global){
  'use strict';

  const CATEGORIES={manufacturing:'제조',onestop:'원스톱 서비스',circuit:'회로개발',structure:'구조설계',internal:'내부 프로젝트'};
  const SCHEDULE_KINDS={meeting:'미팅',conference:'회의',trip:'출장',annual_leave:'연차',half_day_am:'오전 반차',half_day_pm:'오후 반차',other:'기타 일정'};
  const LEAVE_KINDS=new Set(['annual_leave','half_day_am','half_day_pm']);
  const WEEKDAYS=['일','월','화','수','목','금','토'];
  const TYPE_ORDER={schedule:0,production:1,deadline:2,activity:3};
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text=value=>typeof value==='string'?value:'';

  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const parsed=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
  }
  function validMonth(value){return typeof value==='string'&&/^\d{4}-\d{2}$/.test(value)&&validDate(`${value}-01`);}
  function validTime(value){return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
  function addDays(date,days){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
  function shiftMonth(month,offset){const value=new Date(`${month}-01T00:00:00Z`);value.setUTCMonth(value.getUTCMonth()+offset);return value.toISOString().slice(0,7);}
  function shortDate(date){return `${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`;}
  function fullDate(date){return date.replaceAll('-','.');}
  function koreanDay(date){return `${Number(date.slice(5,7))}월 ${Number(date.slice(8,10))}일 (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;}
  function categoryKey(category){return Object.prototype.hasOwnProperty.call(CATEGORIES,category)?category:'other';}

  /** Normalize supplied records without mutating them or expanding date ranges. */
  function buildEvents(projects=[],activities=[],schedules=[],options={}){
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
    for(const schedule of Array.isArray(schedules)?schedules:[]){
      if(!schedule||typeof schedule.id!=='string'||!schedule.id||(schedule.archived===true&&options.showArchived!==true))continue;
      const start=validDate(schedule.startDate)?schedule.startDate:null;
      const end=schedule.endDate===null||schedule.endDate===undefined||schedule.endDate===''?start:validDate(schedule.endDate)?schedule.endDate:null;
      if(!start||!end||end<start)continue;
      const kind=Object.prototype.hasOwnProperty.call(SCHEDULE_KINDS,schedule.kind)?schedule.kind:'other';
      const isLeave=LEAVE_KINDS.has(kind);
      const attendees=text(schedule.attendees);
      const allDay=schedule.allDay===true;
      if(isLeave&&(!allDay||schedule.startTime!=null||schedule.endTime!=null||!attendees.trim()||(kind!=='annual_leave'&&start!==end)))continue;
      if(!allDay&&(!validTime(schedule.startTime)||!validTime(schedule.endTime)))continue;
      const startTime=!allDay&&validTime(schedule.startTime)?schedule.startTime:'';
      const endTime=!allDay&&validTime(schedule.endTime)?schedule.endTime:'';
      if(!allDay&&start===end&&startTime&&endTime&&startTime>endTime)continue;
      const title=text(schedule.title)||SCHEDULE_KINDS[kind];
      events.push({id:`schedule:${schedule.id}`,type:'schedule',scheduleId:schedule.id,projectId:null,activityId:null,
        kind,category:null,title,displayTitle:isLeave?attendees.trim():title,isLeave,stageLabel:SCHEDULE_KINDS[kind],
        startDate:start,endDate:end,date:end,isRange:start!==end,allDay,startTime,endTime,
        attendees:isLeave?attendees.trim():attendees,location:text(schedule.location),notes:text(schedule.notes),
        done:false,doneDate:null,actualOnly:false,missingEnd:false,archived:schedule.archived===true});
    }
    return events.sort((a,b)=>a.startDate.localeCompare(b.startDate)||TYPE_ORDER[a.type]-TYPE_ORDER[b.type]
      ||(a.type==='schedule'&&b.type==='schedule'?Number(!a.allDay)-Number(!b.allDay):0)
      ||text(a.startTime).localeCompare(text(b.startTime))||a.title.localeCompare(b.title,'ko')||a.id.localeCompare(b.id));
  }

  /** A range matches its start and end dates inclusively; no daily records are stored. */
  function getEventsForDate(events,date){
    if(!Array.isArray(events)||!validDate(date))return [];
    return events.filter(event=>event&&validDate(event.startDate)&&validDate(event.endDate)&&event.startDate<=date&&date<=event.endDate);
  }

  function eventTypeLabel(event){return event.type==='schedule'?event.stageLabel:event.type==='production'?'제작':event.type==='activity'?'활동':event.stageLabel==='입고'?'입고':'완료';}
  function eventColorClass(event){return event.type==='schedule'?`rc-schedule-${event.kind}`:`rc-category-${event.category}`;}
  function scheduleDateText(event){
    if(event.isLeave)return `${rangeText(event)} · ${event.stageLabel}`;
    if(event.allDay)return `${rangeText(event)} · 종일`;
    const start=`${fullDate(event.startDate)} ${event.startTime||'시간 미입력'}`;
    const end=`${event.startDate===event.endDate?'':`${fullDate(event.endDate)} `}${event.endTime||'종료 시간 미입력'}`;
    return `${start} – ${end}`;
  }
  function rangeText(event){
    if(event.actualOnly)return `실제 완료 ${fullDate(event.endDate)}`;
    if(event.missingEnd)return `${fullDate(event.startDate)}부터 · 종료일 미정`;
    return event.isRange?`${fullDate(event.startDate)} – ${fullDate(event.endDate)}`:fullDate(event.endDate);
  }
  function eventDescription(event){
    if(event.type==='schedule')return `${event.stageLabel} · ${event.displayTitle||event.title}${event.isLeave&&event.title!==event.displayTitle?` · ${event.title}`:''} · ${scheduleDateText(event)}${event.attendees?` · ${event.isLeave?'휴가자':'참석자'} ${event.attendees}`:''}${event.location?` · 장소 ${event.location}`:''}${event.archived?' · 보관됨':''}`;
    const completed=event.done?`완료 · ${event.doneDate?`실제 완료일 ${fullDate(event.doneDate)}`:'완료일 미입력'}`:'미완료';
    return `${event.stageLabel} · ${event.title} · ${rangeText(event)} · ${completed}`;
  }
  function eventPill(event,date,index){
    const rangeClass=event.isRange?(date===event.startDate?' rc-range-start':date===event.endDate?' rc-range-end':' rc-range-middle'):'';
    const prefix=event.done?'✓ ':event.isRange&&date!==event.startDate?'↔ ':'';
    return `<button type="button" class="rc-event ${eventColorClass(event)}${event.isLeave?' rc-event-leave':''}${event.done?' rc-event-done':''}${event.archived?' rc-event-archived':''}${rangeClass}" data-rc-event="${index}" title="${escapeHTML(eventDescription(event))}" aria-label="${escapeHTML(eventDescription(event))}"><span class="rc-event-type">${escapeHTML(prefix+eventTypeLabel(event))}</span><span class="rc-event-name">${escapeHTML(event.displayTitle||event.title)}</span></button>`;
  }
  function scheduleAgendaMarkup(event,index,today){
    const status=event.archived?'보관됨':event.endDate<today?'지난 일정':event.startDate<=today&&today<=event.endDate?'오늘 일정':'예정';
    return `<button type="button" class="rc-agenda-item ${eventColorClass(event)}${event.archived?' rc-event-archived':''}" data-rc-event="${index}" aria-label="${escapeHTML(eventDescription(event))}, 일정 수정"><span class="rc-agenda-meta"><span>${escapeHTML(event.stageLabel)}</span><span class="rc-agenda-status">${status}</span></span><strong>${escapeHTML(event.displayTitle||event.title)}</strong>${event.isLeave&&event.title!==event.displayTitle?`<span class="rc-agenda-task">${escapeHTML(event.title)}</span>`:''}<span class="rc-agenda-date">${escapeHTML(scheduleDateText(event))}</span>${event.attendees?`<span class="rc-schedule-detail">${event.isLeave?'휴가자':'참석자'} <span>${escapeHTML(event.attendees)}</span></span>`:''}${event.location?`<span class="rc-schedule-detail">장소 <span>${escapeHTML(event.location)}</span></span>`:''}${event.notes?`<span class="rc-schedule-notes">${escapeHTML(event.notes)}</span>`:''}</button>`;
  }
  function agendaMarkup(events,selectedDate,today){
    const selected=getEventsForDate(events,selectedDate);
    return `<section class="rc-agenda" aria-labelledby="rc-agenda-title"><header class="rc-agenda-header"><h3 id="rc-agenda-title">${escapeHTML(koreanDay(selectedDate))}${selectedDate===today?' <span class="rc-today-label">오늘</span>':''}</h3><span>${selected.length}건의 일정</span></header>${selected.length?selected.map(event=>{
      const overdue=!event.done&&!event.missingEnd&&event.endDate<today;
      const eventIndex=events.indexOf(event);
      if(event.type==='schedule')return scheduleAgendaMarkup(event,eventIndex,today);
      return `<button type="button" class="rc-agenda-item rc-category-${event.category}" data-rc-event="${eventIndex}" aria-label="${escapeHTML(eventDescription(event))}, 수정 화면 열기"><span class="rc-agenda-meta"><span>${escapeHTML(CATEGORIES[event.category]||'프로젝트')} · ${escapeHTML(event.stageLabel)}</span><span class="rc-agenda-status${event.done?' is-done':overdue?' is-overdue':''}">${event.done?'✓ 완료':overdue?'기한 경과':'예정'}</span></span><strong>${escapeHTML(event.title)}</strong>${event.type==='activity'?`<span class="rc-agenda-task">${escapeHTML(event.client)}</span>`:event.task?`<span class="rc-agenda-task">${escapeHTML(event.task)}</span>`:''}<span class="rc-agenda-date">${event.actualOnly?'':'예정 '}${escapeHTML(rangeText(event))}</span>${event.done?`<span class="rc-agenda-actual">${event.doneDate?`실제 완료일 ${escapeHTML(fullDate(event.doneDate))}`:'완료일 미입력'}</span>`:''}${event.startTime?`<span class="rc-agenda-date">${escapeHTML(event.startTime)}${Number.isFinite(event.durationMinutes)?` · 약 ${event.durationMinutes}분`:''}</span>`:''}${event.owner?`<span class="rc-agenda-owner">담당 ${escapeHTML(event.owner)}</span>`:''}</button>`;
    }).join(''):'<p class="rc-empty">선택한 날짜에 등록된 일정이 없습니다.</p>'}</section>`;
  }

  function render(container,options={}){
    if(!container||typeof container.replaceChildren!=='function')return;
    const expandedDates=new Set(Array.from(container.querySelectorAll('details[data-rc-overflow-date][open]'),details=>details.dataset.rcOverflowDate));
    const today=validDate(options.today)?options.today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const month=validMonth(options.month)?options.month:today.slice(0,7);
    const selectedDate=validDate(options.selectedDate)?options.selectedDate:today;
    const projects=Array.isArray(options.projects)?options.projects.filter(p=>p&&typeof p.id==='string'&&p.id):[];
    const events=buildEvents(projects,options.activities,options.schedules,{showArchived:options.showArchived===true});
    const first=`${month}-01`,nextMonth=shiftMonth(month,1),last=addDays(`${nextMonth}-01`,-1);
    const gridStart=addDays(first,-new Date(`${first}T00:00:00Z`).getUTCDay());
    const monthEvents=events.filter(event=>event.startDate<=last&&event.endDate>=first);
    const ownScheduled=new Set(events.filter(event=>event.type==='production'||event.type==='deadline').map(event=>event.projectId));
    const undated=projects.filter(project=>!ownScheduled.has(project.id));
    const visibleCategories=Object.keys(CATEGORIES).filter(category=>projects.some(project=>project.category===category));
    const canCreate=typeof options.onCreateSchedule==='function';
    const showScheduleLegend=canCreate||Array.isArray(options.schedules);
    const days=Array.from({length:42},(_,index)=>{
      const date=addDays(gridStart,index),dayEvents=getEventsForDate(events,date),outside=date.slice(0,7)!==month;
      const day=new Date(`${date}T00:00:00Z`).getUTCDay();
      return `<div class="rc-day${outside?' rc-day-outside':''}${date===today?' rc-day-today':''}${date===selectedDate?' rc-day-selected':''}${day===0?' rc-sunday':day===6?' rc-saturday':''}" data-rc-cell-date="${date}">
        <button type="button" class="rc-date-button" data-rc-date="${date}"${canCreate?' data-rc-create="true"':''} aria-label="${Number(date.slice(0,4))}년 ${escapeHTML(koreanDay(date))} ${dayEvents.length}건의 일정${date===today?', 오늘':''}${canCreate?', 일정 추가':''}" aria-pressed="${date===selectedDate}"><span>${Number(date.slice(8,10))}</span>${dayEvents.length?`<small>${dayEvents.length}건</small>`:''}</button>
        <div class="rc-day-events">${dayEvents.slice(0,3).map(event=>eventPill(event,date,events.indexOf(event))).join('')}${dayEvents.length>3?`<details class="rc-overflow" data-rc-overflow-date="${date}"${expandedDates.has(date)?' open':''}><summary class="rc-more" aria-controls="rc-overflow-${date}"><span class="sr-only">${escapeHTML(koreanDay(date))} 일정 </span><span class="rc-more-closed">＋ ${dayEvents.length-3}개 더</span><span class="rc-more-open">전체 ${dayEvents.length}건 · 접기</span></summary><div class="rc-overflow-panel" id="rc-overflow-${date}">${dayEvents.slice(3).map(event=>eventPill(event,date,events.indexOf(event))).join('')}<button type="button" class="rc-overflow-close" data-rc-close-overflow>접기</button></div></details>`:''}</div>
      </div>`;
    }).join('');
    container.innerHTML=`<section class="rc-calendar" aria-label="프로젝트·미팅·회의·출장 일정 달력">
      <header class="rc-toolbar"><div><h2>${Number(month.slice(0,4))}년 ${Number(month.slice(5,7))}월</h2><p>일정 ${monthEvents.length}건 <span>· 완료 확인 ${monthEvents.filter(event=>event.done).length}건</span></p></div>
        <div class="rc-toolbar-actions">${canCreate?'<button type="button" class="rc-add-schedule" data-rc-add>＋ 일정 추가</button>':''}<div class="rc-navigation"><button type="button" data-rc-nav="prev" aria-label="이전 달">‹</button><button type="button" data-rc-nav="today">오늘</button><button type="button" data-rc-nav="next" aria-label="다음 달">›</button></div></div>
      </header>
      <p class="rc-plan-note">프로젝트는 예정일 기준 · 실제 완료일은 상세에서 확인${showScheduleLegend?' · 미팅·회의·출장은 등록 일시 기준':''}</p>
      <div class="rc-category-legend" aria-label="프로젝트 분야별 색상">${visibleCategories.map(category=>`<span class="rc-category-${category}"><i></i>${escapeHTML(CATEGORIES[category])}</span>`).join('')}<span class="rc-type-legend">제작 · 입고/완료 · 활동 &nbsp; / &nbsp; ✓ 완료 확인</span></div>
      ${showScheduleLegend?`<div class="rc-schedule-legend" aria-label="일반 일정 유형별 색상"><span class="rc-legend-caption">일반 일정</span>${Object.entries(SCHEDULE_KINDS).map(([kind,label])=>`<span class="rc-schedule-${kind}"><i></i>${escapeHTML(label)}</span>`).join('')}</div>`:''}
      <div class="rc-layout"><div class="rc-month"><p class="rc-mobile-hint">${canCreate?'날짜를 누르면 일정을 추가할 수 있습니다.':''} 작은 화면에서는 달력을 옆으로 밀어 보세요.</p><div class="rc-grid-scroll"><div class="rc-grid"><div class="rc-weekdays">${WEEKDAYS.map((name,index)=>`<span class="${index===0?'rc-sunday':index===6?'rc-saturday':''}">${name}</span>`).join('')}</div><div class="rc-days">${days}</div></div></div></div>${agendaMarkup(events,selectedDate,today)}</div>
      <section class="rc-undated" aria-labelledby="rc-undated-title"><header><h3 id="rc-undated-title">일정 미입력 프로젝트 <span>${undated.length}건</span></h3><p>프로젝트를 눌러 제작·입고·최종 완료 예정일을 입력할 수 있습니다.</p></header>${undated.length?`<div class="rc-undated-list">${undated.map((project,index)=>`<button type="button" class="rc-undated-item rc-category-${categoryKey(project.category)}" data-rc-undated="${index}"><span>${escapeHTML(CATEGORIES[project.category]||'프로젝트')}</span><strong>${escapeHTML(project.client||project.task||'프로젝트')}</strong>${project.task?`<small>${escapeHTML(project.task)}</small>`:''}</button>`).join('')}</div>`:'<p class="rc-empty">모든 프로젝트에 일정이 입력되어 있습니다.</p>'}</section>
    </section>`;
    function selectDate(date,create){
      if(date.slice(0,7)!==month&&typeof options.onMonthChange==='function')options.onMonthChange(date.slice(0,7));
      if(typeof options.onDateSelect==='function')options.onDateSelect(date);
      if(create&&canCreate)options.onCreateSchedule(date);
    }
    for(const button of container.querySelectorAll('[data-rc-add]'))button.addEventListener('click',()=>options.onCreateSchedule(selectedDate));
    for(const button of container.querySelectorAll('[data-rc-nav]'))button.addEventListener('click',()=>{
      const action=button.dataset.rcNav;
      if(action==='today'){
        if(typeof options.onMonthChange==='function')options.onMonthChange(today.slice(0,7));
        if(typeof options.onDateSelect==='function')options.onDateSelect(today);
      }else if(typeof options.onMonthChange==='function')options.onMonthChange(shiftMonth(month,action==='prev'?-1:1));
    });
    for(const button of container.querySelectorAll('[data-rc-date]'))button.addEventListener('click',()=>selectDate(button.dataset.rcDate,button.dataset.rcCreate==='true'));
    for(const cell of container.querySelectorAll('[data-rc-cell-date]'))cell.addEventListener('click',event=>{
      if(event.target.closest&&event.target.closest('button,details'))return;
      selectDate(cell.dataset.rcCellDate,canCreate);
    });
    function closeOverflow(details){details.open=false;details.querySelector('summary').focus();}
    for(const details of container.querySelectorAll('[data-rc-overflow-date]')){
      details.querySelector('[data-rc-close-overflow]').addEventListener('click',()=>closeOverflow(details));
      details.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){event.preventDefault();event.stopPropagation();closeOverflow(details);}});
    }
    for(const button of container.querySelectorAll('[data-rc-event]'))button.addEventListener('click',()=>{
      const event=events[Number(button.dataset.rcEvent)];if(!event)return;
      if(event.type==='schedule'){
        if(typeof options.onOpenSchedule==='function')options.onOpenSchedule(event.scheduleId);
      }else if(event.type==='activity'&&typeof options.onOpenActivity==='function')options.onOpenActivity(event.activityId);
      else if(typeof options.onOpenProject==='function')options.onOpenProject(event.projectId);
    });
    for(const button of container.querySelectorAll('[data-rc-undated]'))button.addEventListener('click',()=>{
      const project=undated[Number(button.dataset.rcUndated)];if(project&&typeof options.onOpenProject==='function')options.onOpenProject(project.id);
    });
  }

  global.ReductCalendar=Object.freeze({buildEvents,getEventsForDate,render});
})(typeof window!=='undefined'?window:globalThis);
