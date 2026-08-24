const header = document.getElementById('siteHeader');
const toggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const mobileLinks = mobileMenu.querySelectorAll('a');

function setHeader(){
  header.classList.toggle('scrolled', window.scrollY > 18);
}
setHeader();
window.addEventListener('scroll', setHeader, {passive:true});

function closeMenu(){
  toggle.classList.remove('active');
  toggle.setAttribute('aria-expanded','false');
  mobileMenu.classList.remove('open');
  mobileMenu.setAttribute('aria-hidden','true');
  document.body.classList.remove('menu-open');
}

toggle.addEventListener('click',()=>{
  const isOpen = mobileMenu.classList.toggle('open');
  toggle.classList.toggle('active',isOpen);
  toggle.setAttribute('aria-expanded',String(isOpen));
  mobileMenu.setAttribute('aria-hidden',String(!isOpen));
  document.body.classList.toggle('menu-open',isOpen);
});
mobileLinks.forEach(link=>link.addEventListener('click',closeMenu));

const revealObserver = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
},{threshold:.12,rootMargin:'0px 0px -6%'});

document.querySelectorAll('.reveal').forEach(el=>revealObserver.observe(el));

const sections = [...document.querySelectorAll('main section[id]')];
const navLinks = [...document.querySelectorAll('.desktop-nav a')];
const sectionObserver = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      navLinks.forEach(a=>a.classList.toggle('active',a.getAttribute('href') === `#${entry.target.id}`));
    }
  });
},{rootMargin:'-45% 0px -45%',threshold:0});
sections.forEach(s=>sectionObserver.observe(s));

const form = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');
const submitButton = form?.querySelector('button[type="submit"]');

if(form){
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!form.reportValidity()) return;

    const data = new FormData(form);
    const originalButtonText = submitButton.textContent;

    submitButton.disabled = true;
    submitButton.textContent = 'SENDING...';
    formStatus.className = 'form-status';
    formStatus.textContent = '문의 내용을 전송하고 있습니다.';

    const payload = {
      _subject: `[REDUCT 홈페이지 문의] ${data.get('type')} / ${data.get('company') || data.get('name')}`,
      _template: 'table',
      _replyto: data.get('email'),
      Name: data.get('name'),
      Company: data.get('company') || '-',
      Email: data.get('email'),
      Phone: data.get('phone') || '-',
      Inquiry_Type: data.get('type'),
      Message: data.get('message')
    };

    try{
      const response = await fetch('https://formsubmit.co/ajax/ceo@reduct.co.kr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(()=>({}));
      if(!response.ok || result.success === 'false' || result.success === false){
        throw new Error(result.message || 'Submission failed');
      }

      form.reset();
      formStatus.className = 'form-status success';
      formStatus.textContent = '문의가 정상적으로 전송되었습니다. 확인 후 연락드리겠습니다.';
    }catch(error){
      console.error('Inquiry submission failed:', error);
      formStatus.className = 'form-status error';
      formStatus.textContent = '전송에 실패했습니다. 잠시 후 다시 시도하거나 ceo@reduct.co.kr로 직접 문의해 주세요.';
    }finally{
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  });
}

// REDUCT Cost Optimization Pre-Diagnosis Bot
(() => {
  const launcher = document.getElementById('diagnosisLauncher');
  const bot = document.getElementById('diagnosisBot');
  const closeBtn = document.getElementById('diagnosisClose');
  const resetBtn = document.getElementById('diagnosisReset');
  const body = document.getElementById('diagnosisBody');
  const stepText = document.getElementById('diagnosisStepText');
  const progressBar = document.getElementById('diagnosisProgressBar');
  if(!launcher || !bot || !body) return;

  const TOTAL = 7;
  const state = {
    step: 1,
    category: '',
    stage: '',
    currentCost: '',
    targetCost: '',
    quantity: '',
    documents: '',
    note: '',
    name: '',
    company: '',
    email: '',
    phone: ''
  };

  const categoryOptions = [
    ['장비 전체 원가절감','장비 전체 원가절감'],
    ['부품 제작비 절감','부품 제작비 절감'],
    ['신규 부품·OEM 제작','신규 부품·OEM 제작'],
    ['하드웨어·펌웨어 개발','하드웨어·펌웨어 개발'],
    ['금형·사출 최적화','금형·사출 최적화'],
    ['구조·기구설계','구조·기구설계']
  ];
  const stageOptions = [
    ['현재 양산·제작 중','현재 양산·제작 중'],
    ['개발·설계 중','개발·설계 중'],
    ['기존품 대체 검토','기존품 대체 검토'],
    ['외주 견적 비교 중','외주 견적 비교 중'],
    ['신규 프로젝트','신규 프로젝트']
  ];
  const docOptions = [
    ['도면 보유','도면 보유'],
    ['도면 + BOM 보유','도면 + BOM 보유'],
    ['실물만 보유','실물만 보유'],
    ['자료 없음','자료 없음']
  ];

  function esc(v=''){
    return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function num(v){ return Number(String(v).replace(/[^0-9.]/g,'')) || 0; }
  function won(v){ return num(v) ? `${Math.round(num(v)).toLocaleString('ko-KR')}원` : '-'; }
  function setProgress(){
    stepText.textContent = `STEP ${Math.min(state.step,TOTAL)} / ${TOTAL}`;
    progressBar.style.width = `${Math.min(state.step,TOTAL) / TOTAL * 100}%`;
  }
  function openBot(){
    bot.classList.add('open'); bot.setAttribute('aria-hidden','false'); launcher.setAttribute('aria-expanded','true'); document.body.classList.add('diagnosis-open');
  }
  function closeBot(){
    bot.classList.remove('open'); bot.setAttribute('aria-hidden','true'); launcher.setAttribute('aria-expanded','false'); document.body.classList.remove('diagnosis-open');
  }
  function options(items, key){
    return `<div class="diagnosis-options">${items.map(([label,value])=>`<button class="diagnosis-option" type="button" data-d-key="${key}" data-d-value="${esc(value)}">${esc(label)}</button>`).join('')}</div>`;
  }
  function render(){
    setProgress();
    if(state.step === 1){
      body.innerHTML = `<div class="diagnosis-message"><strong>어떤 비용을 줄이고 싶으신가요?</strong>현재 검토하려는 영역을 선택해 주세요.<p class="diagnosis-sub">정확한 견적이 아니라, REDUCT에서 어떤 방식으로 검토해야 하는지 판단하기 위한 사전진단입니다.</p></div>${options(categoryOptions,'category')}`;
    } else if(state.step === 2){
      body.innerHTML = `<div class="diagnosis-message"><strong>현재 프로젝트 상태는 어떤 단계인가요?</strong>현재 제작·개발 상황에 가장 가까운 항목을 선택해 주세요.</div>${options(stageOptions,'stage')}`;
    } else if(state.step === 3){
      body.innerHTML = `<div class="diagnosis-message"><strong>현재 비용과 목표 비용을 알려주세요.</strong>부품이면 개당 단가, 장비면 대당 제조원가, 개발 프로젝트면 총 예산 기준으로 입력하면 됩니다.<p class="diagnosis-sub">정확한 숫자가 없으면 비워두셔도 됩니다.</p></div>
      <div class="diagnosis-fields two">
        <label class="diagnosis-field"><span>현재 비용 (원)</span><input id="dCurrentCost" inputmode="numeric" type="number" min="0" placeholder="예: 180000" value="${esc(state.currentCost)}"></label>
        <label class="diagnosis-field"><span>목표 비용 (원)</span><input id="dTargetCost" inputmode="numeric" type="number" min="0" placeholder="예: 130000" value="${esc(state.targetCost)}"></label>
      </div><div class="diagnosis-actions"><button class="diagnosis-next" id="dCostNext" type="button">다음</button></div>`;
    } else if(state.step === 4){
      body.innerHTML = `<div class="diagnosis-message"><strong>예상 제작 수량은 어느 정도인가요?</strong>원가 최적화는 수량에 따라 적합한 가공법과 제작사가 달라집니다.</div>
      <div class="diagnosis-fields"><label class="diagnosis-field"><span>예상 수량</span><input id="dQuantity" type="text" placeholder="예: 월 20개 / 연 500대 / 시제품 3개" value="${esc(state.quantity)}"></label></div>
      <div class="diagnosis-actions"><button class="diagnosis-next" id="dQtyNext" type="button">다음</button></div>`;
    } else if(state.step === 5){
      body.innerHTML = `<div class="diagnosis-message"><strong>검토 가능한 자료가 있나요?</strong>도면이나 BOM이 있으면 원가 상승 요인과 대체 가능성을 더 빠르게 판단할 수 있습니다.</div>${options(docOptions,'documents')}`;
    } else if(state.step === 6){
      body.innerHTML = `<div class="diagnosis-message"><strong>추가로 알려주실 내용이 있나요?</strong>재질, 공차, 현재 문제점, 납기, 원가가 높은 것으로 예상되는 부품 등을 적어주세요.</div>
      <div class="diagnosis-fields"><label class="diagnosis-field"><span>추가 내용 (선택)</span><textarea id="dNote" placeholder="예: SUS 가공품 8종의 단가가 높고 납기가 3주 이상 걸립니다.">${esc(state.note)}</textarea></label></div>
      <div class="diagnosis-actions"><button class="diagnosis-next" id="dNoteNext" type="button">진단 결과 보기</button></div>`;
    } else if(state.step === 7){
      const cur=num(state.currentCost), tar=num(state.targetCost);
      const saving = cur>0 && tar>0 && cur>tar ? cur-tar : 0;
      const rate = saving ? (saving/cur*100).toFixed(1) : '';
      body.innerHTML = `<div class="diagnosis-message"><strong>사전진단 정보가 정리되었습니다.</strong>아래 내용을 REDUCT에 보내면 실제 도면·사양·제작조건을 기준으로 검토할 수 있습니다.</div>
      <div class="diagnosis-summary">
        <div class="diagnosis-summary-row"><span>검토 영역</span><strong>${esc(state.category)}</strong></div>
        <div class="diagnosis-summary-row"><span>현재 단계</span><strong>${esc(state.stage)}</strong></div>
        <div class="diagnosis-summary-row"><span>비용 조건</span><strong>현재 ${won(state.currentCost)} → 목표 ${won(state.targetCost)}</strong></div>
        <div class="diagnosis-summary-row"><span>예상 수량 / 자료</span><strong>${esc(state.quantity || '-')} · ${esc(state.documents)}</strong></div>
      </div>
      ${saving ? `<div class="diagnosis-saving"><span>입력 기준 목표 절감폭</span><strong>${saving.toLocaleString('ko-KR')}원 / ${rate}%</strong></div>` : ''}
      <div class="diagnosis-fields two">
        <label class="diagnosis-field"><span>이름 *</span><input id="dName" type="text" autocomplete="name" value="${esc(state.name)}"></label>
        <label class="diagnosis-field"><span>회사명</span><input id="dCompany" type="text" autocomplete="organization" value="${esc(state.company)}"></label>
        <label class="diagnosis-field"><span>이메일 *</span><input id="dEmail" type="email" autocomplete="email" value="${esc(state.email)}"></label>
        <label class="diagnosis-field"><span>연락처 *</span><input id="dPhone" type="tel" autocomplete="tel" value="${esc(state.phone)}"></label>
      </div>
      <label class="diagnosis-consent"><input id="dConsent" type="checkbox"> <span>사전진단 및 상담을 위한 개인정보 수집·이용에 동의합니다. 입력정보는 상담 목적으로만 사용합니다.</span></label>
      <div class="diagnosis-actions"><button class="diagnosis-next" id="dSubmit" type="button">REDUCT에 진단 요청 보내기</button></div>
      <div class="diagnosis-status" id="dStatus"></div>`;
    }
    body.scrollTop = 0;
    bindStep();
  }

  function bindStep(){
    body.querySelectorAll('[data-d-key]').forEach(btn => btn.addEventListener('click', () => {
      state[btn.dataset.dKey] = btn.dataset.dValue;
      state.step += 1; render();
    }));
    body.querySelector('#dCostNext')?.addEventListener('click',()=>{
      state.currentCost = document.getElementById('dCurrentCost').value;
      state.targetCost = document.getElementById('dTargetCost').value;
      state.step=4;render();
    });
    body.querySelector('#dQtyNext')?.addEventListener('click',()=>{
      state.quantity = document.getElementById('dQuantity').value.trim();
      if(!state.quantity){ document.getElementById('dQuantity').focus(); return; }
      state.step=5;render();
    });
    body.querySelector('#dNoteNext')?.addEventListener('click',()=>{
      state.note = document.getElementById('dNote').value.trim(); state.step=7;render();
    });
    body.querySelector('#dSubmit')?.addEventListener('click',submitDiagnosis);
  }

  async function submitDiagnosis(){
    const status = document.getElementById('dStatus');
    const button = document.getElementById('dSubmit');
    state.name = document.getElementById('dName').value.trim();
    state.company = document.getElementById('dCompany').value.trim();
    state.email = document.getElementById('dEmail').value.trim();
    state.phone = document.getElementById('dPhone').value.trim();
    const consent = document.getElementById('dConsent').checked;
    if(!state.name || !state.email || !state.phone){ status.textContent='이름, 이메일, 연락처를 입력해 주세요.'; return; }
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)){ status.textContent='이메일 주소를 확인해 주세요.'; return; }
    if(!consent){ status.textContent='상담을 위해 개인정보 수집·이용 동의가 필요합니다.'; return; }
    const cur=num(state.currentCost), tar=num(state.targetCost);
    const saving = cur>0 && tar>0 && cur>tar ? cur-tar : 0;
    const rate = saving ? (saving/cur*100).toFixed(1) : '-';
    const payload={
      _subject:`[REDUCT 원가절감 사전진단] ${state.company || state.name} / ${state.category}`,
      _template:'table',_replyto:state.email,
      Name:state.name,Company:state.company || '-',Email:state.email,Phone:state.phone,
      Diagnosis_Type:state.category,Project_Stage:state.stage,
      Current_Cost:cur ? `${cur.toLocaleString('ko-KR')}원` : '미입력',
      Target_Cost:tar ? `${tar.toLocaleString('ko-KR')}원` : '미입력',
      Target_Saving:saving ? `${saving.toLocaleString('ko-KR')}원 (${rate}%)` : '추가 검토 필요',
      Quantity:state.quantity,Documents:state.documents,Additional_Note:state.note || '-'
    };
    try{
      button.disabled=true;button.textContent='전송 중...';status.textContent='사전진단 정보를 전송하고 있습니다.';
      const response=await fetch('https://formsubmit.co/ajax/ceo@reduct.co.kr',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok || result.success===false || result.success==='false') throw new Error(result.message||'failed');
      status.className='diagnosis-status success';
      status.innerHTML='<strong>진단 요청이 전송되었습니다.</strong><br>도면이나 BOM이 있다면 회신 메일에 첨부해 주세요. REDUCT에서 검토 후 연락드리겠습니다.';
      button.textContent='전송 완료';
    }catch(err){
      console.error('Diagnosis submission failed:',err);status.className='diagnosis-status error';status.textContent='전송에 실패했습니다. 잠시 후 다시 시도하거나 ceo@reduct.co.kr로 문의해 주세요.';button.disabled=false;button.textContent='REDUCT에 진단 요청 보내기';
    }
  }
  function reset(){
    Object.assign(state,{step:1,category:'',stage:'',currentCost:'',targetCost:'',quantity:'',documents:'',note:'',name:'',company:'',email:'',phone:''});render();
  }

  launcher.addEventListener('click',()=>{openBot();render();});
  closeBtn?.addEventListener('click',closeBot);
  resetBtn?.addEventListener('click',reset);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&bot.classList.contains('open'))closeBot();});
  render();
})();
