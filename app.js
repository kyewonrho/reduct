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
      _subject: `[홈페이지 문의] ${data.get('type')} / ${data.get('company') || data.get('name')}`,
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

// Multilingual Cost Optimization Pre-Diagnosis Bot
(() => {
  const launcher = document.getElementById('diagnosisLauncher');
  const bot = document.getElementById('diagnosisBot');
  const closeBtn = document.getElementById('diagnosisClose');
  const resetBtn = document.getElementById('diagnosisReset');
  const body = document.getElementById('diagnosisBody');
  const stepText = document.getElementById('diagnosisStepText');
  const progressBar = document.getElementById('diagnosisProgressBar');
  if(!launcher || !bot || !body) return;

  const rawLang=(document.documentElement.lang || 'ko').toLowerCase();
  const LANG=rawLang.startsWith('ja')?'ja':rawLang.startsWith('en')?'en':'ko';
  const I18N={
    ko:{
      categories:['장비 전체 원가절감','부품 제작비 절감','신규 부품·OEM 제작','하드웨어·펌웨어 개발','금형·사출 최적화','구조·기구설계'],
      stages:['현재 양산·제작 중','개발·설계 중','기존품 대체 검토','외주 견적 비교 중','신규 프로젝트'],
      docs:['도면 보유','도면 + BOM 보유','실물만 보유','자료 없음'],
      q1:'어떤 비용을 줄이고 싶으신가요?', q1b:'현재 검토하려는 영역을 선택해 주세요.', q1s:'정확한 견적이 아니라, 어떤 방식으로 검토해야 하는지 판단하기 위한 사전진단입니다.',
      q2:'현재 프로젝트 상태는 어떤 단계인가요?', q2b:'현재 제작·개발 상황에 가장 가까운 항목을 선택해 주세요.',
      q3:'현재 비용과 목표 비용을 알려주세요.', q3b:'부품이면 개당 단가, 장비면 대당 제조원가, 개발 프로젝트면 총 예산 기준으로 입력하면 됩니다.', q3s:'정확한 숫자가 없으면 비워두셔도 됩니다.',
      current:'현재 비용 (원)', target:'목표 비용 (원)', exCurrent:'예: 180000', exTarget:'예: 130000', next:'다음',
      q4:'예상 제작 수량은 어느 정도인가요?', q4b:'원가 최적화는 수량에 따라 적합한 가공법과 제작사가 달라집니다.', quantity:'예상 수량', exQty:'예: 월 20개 / 연 500대 / 시제품 3개',
      q5:'검토 가능한 자료가 있나요?', q5b:'도면이나 BOM이 있으면 원가 상승 요인과 대체 가능성을 더 빠르게 판단할 수 있습니다.',
      q6:'추가로 알려주실 내용이 있나요?', q6b:'재질, 공차, 현재 문제점, 납기, 원가가 높은 것으로 예상되는 부품 등을 적어주세요.', note:'추가 내용 (선택)', exNote:'예: SUS 가공품 8종의 단가가 높고 납기가 3주 이상 걸립니다.', result:'진단 결과 보기',
      done:'사전진단 정보가 정리되었습니다.', doneb:'아래 내용을 보내면 실제 도면·사양·제작조건을 기준으로 검토할 수 있습니다.', area:'검토 영역', stage:'현재 단계', cost:'비용 조건', now:'현재', goal:'목표', qtyDocs:'예상 수량 / 자료', saving:'입력 기준 목표 절감폭',
      name:'이름 *', company:'회사명', email:'이메일 *', phone:'연락처 *', consent:'사전진단 및 상담을 위한 개인정보 수집·이용에 동의합니다. 입력정보는 상담 목적으로만 사용합니다.', submit:'진단 요청 보내기',
      needContact:'이름, 이메일, 연락처를 입력해 주세요.', badEmail:'이메일 주소를 확인해 주세요.', needConsent:'상담을 위해 개인정보 수집·이용 동의가 필요합니다.', sending:'사전진단 정보를 전송하고 있습니다.', sent:'진단 요청이 전송되었습니다.', sentb:'도면이나 BOM이 있다면 회신 메일에 첨부해 주세요. 검토 후 연락드리겠습니다.', fail:'전송에 실패했습니다. 잠시 후 다시 시도하거나 ceo@reduct.co.kr로 문의해 주세요.', completed:'전송 완료',
      noInput:'미입력', review:'추가 검토 필요', restart:'처음부터', subject:'[홈페이지 원가절감 사전진단]'
    },
    en:{
      categories:['Equipment cost reduction','Part manufacturing cost reduction','New parts / OEM production','Hardware / firmware development','Mold / injection optimization','Structural / mechanical engineering'],
      stages:['Currently in production','In development / engineering','Reviewing replacement of existing parts','Comparing outsourcing quotes','New project'],
      docs:['Drawings available','Drawings + BOM available','Physical sample only','No materials available'],
      q1:'What would you like to optimize?', q1b:'Select the area you are currently reviewing.', q1s:'This is a preliminary assessment to determine the right cost-optimization approach, not a final quotation.',
      q2:'What stage is the project currently in?', q2b:'Choose the option closest to your current development or production status.',
      q3:'Enter the current cost and target cost.', q3b:'For a part, use the unit price; for equipment, the manufacturing cost per unit; for development, the total project budget.', q3s:'If you do not have an exact figure, you may leave it blank.',
      current:'Current cost (KRW)', target:'Target cost (KRW)', exCurrent:'e.g. 180000', exTarget:'e.g. 130000', next:'Next',
      q4:'What is the expected production volume?', q4b:'The appropriate manufacturing method and supplier depend heavily on volume.', quantity:'Expected quantity', exQty:'e.g. 20/month · 500/year · 3 prototypes',
      q5:'What reference materials are available?', q5b:'Drawings or a BOM help us identify cost drivers and replacement opportunities more quickly.',
      q6:'Anything else we should know?', q6b:'Add material, tolerance, current issues, lead time, or parts you believe are driving cost.', note:'Additional information (optional)', exNote:'e.g. Eight SUS machined parts are expensive and lead time exceeds three weeks.', result:'View assessment',
      done:'Your preliminary assessment is ready.', doneb:'Send the information below and we can review the actual drawings, specifications, and manufacturing conditions.', area:'Review area', stage:'Current stage', cost:'Cost condition', now:'Current', goal:'Target', qtyDocs:'Quantity / materials', saving:'Target reduction based on input',
      name:'Name *', company:'Company', email:'Email *', phone:'Phone *', consent:'I agree to the collection and use of this information for preliminary assessment and consultation. The information will be used only for consultation purposes.', submit:'Send Assessment',
      needContact:'Please enter your name, email, and phone number.', badEmail:'Please check your email address.', needConsent:'Consent is required to proceed with the consultation.', sending:'Sending your assessment information.', sent:'Assessment request sent.', sentb:'If you have drawings or a BOM, attach them when replying to the email. We will review the information and contact you.', fail:'Submission failed. Please try again later or contact ceo@reduct.co.kr.', completed:'Sent',
      noInput:'Not entered', review:'Further review required', restart:'Restart', subject:'[Website Cost Optimization Pre-Check]'
    },
    ja:{
      categories:['設備全体の原価低減','部品製作費の削減','新規部品・OEM製作','ハードウェア・ファームウェア開発','金型・射出成形最適化','構造・機構設計'],
      stages:['現在量産・製作中','開発・設計中','既存品の代替検討','外注見積を比較中','新規プロジェクト'],
      docs:['図面あり','図面 + BOMあり','現物のみ','資料なし'],
      q1:'どのコストを最適化したいですか？', q1b:'現在検討している領域を選択してください。', q1s:'正確な見積ではなく、どのような最適化検討が必要かを判断するための事前診断です。',
      q2:'現在のプロジェクト段階は？', q2b:'現在の製作・開発状況に最も近い項目を選択してください。',
      q3:'現在コストと目標コストを入力してください。', q3b:'部品は単価、設備は1台あたり製造原価、開発案件は総予算を基準に入力できます。', q3s:'正確な数字がない場合は空欄でも構いません。',
      current:'現在コスト（KRW）', target:'目標コスト（KRW）', exCurrent:'例：180000', exTarget:'例：130000', next:'次へ',
      q4:'想定製作数量はどの程度ですか？', q4b:'数量によって適切な加工方法と製作会社が変わります。', quantity:'想定数量', exQty:'例：月20個 / 年500台 / 試作3個',
      q5:'検討可能な資料はありますか？', q5b:'図面やBOMがあれば、原価上昇要因と代替可能性をより早く判断できます。',
      q6:'追加情報があれば入力してください。', q6b:'材質、公差、現在の問題、納期、原価が高いと想定される部品などをご記入ください。', note:'追加内容（任意）', exNote:'例：SUS加工品8種類の単価が高く、納期が3週間以上かかります。', result:'診断結果を見る',
      done:'事前診断情報を整理しました。', doneb:'以下の内容を送信すると、実際の図面・仕様・製造条件を基準に検討できます。', area:'検討領域', stage:'現在段階', cost:'コスト条件', now:'現在', goal:'目標', qtyDocs:'数量 / 資料', saving:'入力値ベースの目標削減幅',
      name:'お名前 *', company:'会社名', email:'メール *', phone:'連絡先 *', consent:'事前診断および相談のための個人情報収集・利用に同意します。入力情報は相談目的にのみ使用します。', submit:'診断内容を送信',
      needContact:'お名前、メール、連絡先を入力してください。', badEmail:'メールアドレスをご確認ください。', needConsent:'相談のため個人情報の収集・利用への同意が必要です。', sending:'事前診断情報を送信しています。', sent:'診断依頼を送信しました。', sentb:'図面やBOMがある場合は返信メールに添付してください。確認後ご連絡します。', fail:'送信に失敗しました。しばらくしてから再度お試しいただくか、ceo@reduct.co.krへお問い合わせください。', completed:'送信完了',
      noInput:'未入力', review:'追加検討が必要', restart:'最初から', subject:'[Webサイト 原価最適化 事前診断]'
    }
  };
  const L=I18N[LANG];
  if(resetBtn) resetBtn.textContent=L.restart;

  const TOTAL=7;
  const state={step:1,category:'',stage:'',currentCost:'',targetCost:'',quantity:'',documents:'',note:'',name:'',company:'',email:'',phone:''};
  const categoryOptions=L.categories.map(x=>[x,x]);
  const stageOptions=L.stages.map(x=>[x,x]);
  const docOptions=L.docs.map(x=>[x,x]);

  function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function num(v){return Number(String(v).replace(/[^0-9.]/g,''))||0;}
  function money(v){
    const n=num(v); if(!n) return '-';
    return LANG==='ko'?`${Math.round(n).toLocaleString('ko-KR')}원`:`KRW ${Math.round(n).toLocaleString(LANG==='ja'?'ja-JP':'en-US')}`;
  }
  function setProgress(){stepText.textContent=`STEP ${Math.min(state.step,TOTAL)} / ${TOTAL}`;progressBar.style.width=`${Math.min(state.step,TOTAL)/TOTAL*100}%`;}
  function openBot(){bot.classList.add('open');bot.setAttribute('aria-hidden','false');launcher.setAttribute('aria-expanded','true');document.body.classList.add('diagnosis-open');}
  function closeBot(){bot.classList.remove('open');bot.setAttribute('aria-hidden','true');launcher.setAttribute('aria-expanded','false');document.body.classList.remove('diagnosis-open');}
  function options(items,key){return `<div class="diagnosis-options">${items.map(([label,value])=>`<button class="diagnosis-option" type="button" data-d-key="${key}" data-d-value="${esc(value)}">${esc(label)}</button>`).join('')}</div>`;}
  function render(){
    setProgress();
    if(state.step===1){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q1}</strong>${L.q1b}<p class="diagnosis-sub">${L.q1s}</p></div>${options(categoryOptions,'category')}`;
    }else if(state.step===2){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q2}</strong>${L.q2b}</div>${options(stageOptions,'stage')}`;
    }else if(state.step===3){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q3}</strong>${L.q3b}<p class="diagnosis-sub">${L.q3s}</p></div><div class="diagnosis-fields two"><label class="diagnosis-field"><span>${L.current}</span><input id="dCurrentCost" inputmode="numeric" type="number" min="0" placeholder="${L.exCurrent}" value="${esc(state.currentCost)}"></label><label class="diagnosis-field"><span>${L.target}</span><input id="dTargetCost" inputmode="numeric" type="number" min="0" placeholder="${L.exTarget}" value="${esc(state.targetCost)}"></label></div><div class="diagnosis-actions"><button class="diagnosis-next" id="dCostNext" type="button">${L.next}</button></div>`;
    }else if(state.step===4){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q4}</strong>${L.q4b}</div><div class="diagnosis-fields"><label class="diagnosis-field"><span>${L.quantity}</span><input id="dQuantity" type="text" placeholder="${L.exQty}" value="${esc(state.quantity)}"></label></div><div class="diagnosis-actions"><button class="diagnosis-next" id="dQtyNext" type="button">${L.next}</button></div>`;
    }else if(state.step===5){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q5}</strong>${L.q5b}</div>${options(docOptions,'documents')}`;
    }else if(state.step===6){
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.q6}</strong>${L.q6b}</div><div class="diagnosis-fields"><label class="diagnosis-field"><span>${L.note}</span><textarea id="dNote" placeholder="${L.exNote}">${esc(state.note)}</textarea></label></div><div class="diagnosis-actions"><button class="diagnosis-next" id="dNoteNext" type="button">${L.result}</button></div>`;
    }else if(state.step===7){
      const cur=num(state.currentCost),tar=num(state.targetCost);const saving=cur>0&&tar>0&&cur>tar?cur-tar:0;const rate=saving?(saving/cur*100).toFixed(1):'';
      const savingText=LANG==='ko'?`${saving.toLocaleString('ko-KR')}원 / ${rate}%`:`KRW ${saving.toLocaleString(LANG==='ja'?'ja-JP':'en-US')} / ${rate}%`;
      body.innerHTML=`<div class="diagnosis-message"><strong>${L.done}</strong>${L.doneb}</div><div class="diagnosis-summary"><div class="diagnosis-summary-row"><span>${L.area}</span><strong>${esc(state.category)}</strong></div><div class="diagnosis-summary-row"><span>${L.stage}</span><strong>${esc(state.stage)}</strong></div><div class="diagnosis-summary-row"><span>${L.cost}</span><strong>${L.now} ${money(state.currentCost)} → ${L.goal} ${money(state.targetCost)}</strong></div><div class="diagnosis-summary-row"><span>${L.qtyDocs}</span><strong>${esc(state.quantity||'-')} · ${esc(state.documents)}</strong></div></div>${saving?`<div class="diagnosis-saving"><span>${L.saving}</span><strong>${savingText}</strong></div>`:''}<div class="diagnosis-fields two"><label class="diagnosis-field"><span>${L.name}</span><input id="dName" type="text" autocomplete="name" value="${esc(state.name)}"></label><label class="diagnosis-field"><span>${L.company}</span><input id="dCompany" type="text" autocomplete="organization" value="${esc(state.company)}"></label><label class="diagnosis-field"><span>${L.email}</span><input id="dEmail" type="email" autocomplete="email" value="${esc(state.email)}"></label><label class="diagnosis-field"><span>${L.phone}</span><input id="dPhone" type="tel" autocomplete="tel" value="${esc(state.phone)}"></label></div><label class="diagnosis-consent"><input id="dConsent" type="checkbox"> <span>${L.consent}</span></label><div class="diagnosis-actions"><button class="diagnosis-next" id="dSubmit" type="button">${L.submit}</button></div><div class="diagnosis-status" id="dStatus"></div>`;
    }
    body.scrollTop=0;bindStep();
  }
  function bindStep(){
    body.querySelectorAll('[data-d-key]').forEach(btn=>btn.addEventListener('click',()=>{state[btn.dataset.dKey]=btn.dataset.dValue;state.step+=1;render();}));
    body.querySelector('#dCostNext')?.addEventListener('click',()=>{state.currentCost=document.getElementById('dCurrentCost').value;state.targetCost=document.getElementById('dTargetCost').value;state.step=4;render();});
    body.querySelector('#dQtyNext')?.addEventListener('click',()=>{state.quantity=document.getElementById('dQuantity').value.trim();if(!state.quantity){document.getElementById('dQuantity').focus();return;}state.step=5;render();});
    body.querySelector('#dNoteNext')?.addEventListener('click',()=>{state.note=document.getElementById('dNote').value.trim();state.step=7;render();});
    body.querySelector('#dSubmit')?.addEventListener('click',submitDiagnosis);
  }
  async function submitDiagnosis(){
    const status=document.getElementById('dStatus');const button=document.getElementById('dSubmit');
    state.name=document.getElementById('dName').value.trim();state.company=document.getElementById('dCompany').value.trim();state.email=document.getElementById('dEmail').value.trim();state.phone=document.getElementById('dPhone').value.trim();
    const consent=document.getElementById('dConsent').checked;
    if(!state.name||!state.email||!state.phone){status.textContent=L.needContact;return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)){status.textContent=L.badEmail;return;}
    if(!consent){status.textContent=L.needConsent;return;}
    const cur=num(state.currentCost),tar=num(state.targetCost);const saving=cur>0&&tar>0&&cur>tar?cur-tar:0;const rate=saving?(saving/cur*100).toFixed(1):'-';
    const payload={_subject:`${L.subject} ${state.company||state.name} / ${state.category}`,_template:'table',_replyto:state.email,Language:LANG,Name:state.name,Company:state.company||'-',Email:state.email,Phone:state.phone,Diagnosis_Type:state.category,Project_Stage:state.stage,Current_Cost:cur?money(cur):L.noInput,Target_Cost:tar?money(tar):L.noInput,Target_Saving:saving?`${money(saving)} (${rate}%)`:L.review,Quantity:state.quantity,Documents:state.documents,Additional_Note:state.note||'-'};
    try{
      button.disabled=true;button.textContent=LANG==='ko'?'전송 중...':LANG==='ja'?'送信中...':'Sending...';status.textContent=L.sending;
      const response=await fetch('https://formsubmit.co/ajax/ceo@reduct.co.kr',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({}));if(!response.ok||result.success===false||result.success==='false')throw new Error(result.message||'failed');
      status.className='diagnosis-status success';status.innerHTML=`<strong>${L.sent}</strong><br>${L.sentb}`;button.textContent=L.completed;
    }catch(err){console.error('Diagnosis submission failed:',err);status.className='diagnosis-status error';status.textContent=L.fail;button.disabled=false;button.textContent=L.submit;}
  }
  function reset(){Object.assign(state,{step:1,category:'',stage:'',currentCost:'',targetCost:'',quantity:'',documents:'',note:'',name:'',company:'',email:'',phone:''});render();}
  launcher.addEventListener('click',()=>{openBot();render();});closeBtn?.addEventListener('click',closeBot);resetBtn?.addEventListener('click',reset);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&bot.classList.contains('open'))closeBot();});render();
})();
