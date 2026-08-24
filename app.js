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
form.addEventListener('submit',(e)=>{
  e.preventDefault();
  if(!form.reportValidity()) return;
  const data = new FormData(form);
  const subject = encodeURIComponent(`[REDUCT 문의] ${data.get('type')} / ${data.get('company') || data.get('name')}`);
  const body = encodeURIComponent(
`이름: ${data.get('name')}\n회사명: ${data.get('company') || '-'}\n이메일: ${data.get('email')}\n연락처: ${data.get('phone') || '-'}\n문의 유형: ${data.get('type')}\n\n문의 내용\n${data.get('message')}`
  );
  window.location.href = `mailto:ceo@reduct.co.kr?subject=${subject}&body=${body}`;
});
