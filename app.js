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
