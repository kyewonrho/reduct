const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const rateBuckets = global.__reductRateBuckets || (global.__reductRateBuckets = new Map());

function text(v, max=500) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 160; }
function validPhone(v){ return /^[0-9+()\-\.\s]{6,40}$/.test(v); }
function getIp(req){
  const f = req.headers['x-forwarded-for'];
  return text(Array.isArray(f) ? f[0] : (f || req.headers['x-real-ip'] || 'unknown'), 80).split(',')[0].trim();
}
function sameSite(req){
  const raw = String(req.headers.origin || req.headers.referer || '');
  if(!raw) return false;
  try{
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'reduct.co.kr' || host === 'www.reduct.co.kr' || host.endsWith('.vercel.app');
  }catch{return false;}
}
function rateLimited(ip){
  const now=Date.now();
  const rec=rateBuckets.get(ip);
  if(!rec || now-rec.start > RATE_WINDOW_MS){ rateBuckets.set(ip,{start:now,count:1}); return false; }
  rec.count += 1;
  return rec.count > RATE_MAX;
}
function hasTooManyUrls(s){ return (String(s).match(/https?:\/\//gi)||[]).length > 4; }
function json(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req,res){
  if(req.method !== 'POST') return json(res,405,{success:false,message:'Method not allowed'});
  if(!sameSite(req)) return json(res,403,{success:false,message:'Origin rejected'});
  const ct=String(req.headers['content-type']||'');
  if(!ct.includes('application/json')) return json(res,415,{success:false,message:'JSON required'});
  const len=Number(req.headers['content-length']||0);
  if(len && len > 20000) return json(res,413,{success:false,message:'Payload too large'});
  const ip=getIp(req);
  if(rateLimited(ip)) return json(res,429,{success:false,message:'Too many requests'});
  const ua=text(req.headers['user-agent'],300);
  if(!ua) return json(res,403,{success:false,message:'User agent required'});

  let b=req.body;
  try{ if(typeof b==='string') b=JSON.parse(b); }catch{return json(res,400,{success:false,message:'Invalid JSON'});}
  if(!b || typeof b!=='object') return json(res,400,{success:false,message:'Invalid payload'});

  // Honeypot and human timing checks are enforced server-side.
  if(text(b.website,200)) return json(res,200,{success:true});
  const started=Number(b.startedAt||0);
  const elapsed=Date.now()-started;
  if(!started || elapsed < 2500 || elapsed > 2*60*60*1000) return json(res,400,{success:false,message:'Invalid submission timing'});

  const kind=text(b.kind,30);
  const email=text(b.Email || b.email,160);
  const phone=text(b.Phone || b.phone,40);
  const name=text(b.Name || b.name,100);
  const company=text(b.Company || b.company,140);
  if(!validEmail(email) || !validPhone(phone) || !name) return json(res,400,{success:false,message:'Invalid contact information'});

  let out={_template:'table',_replyto:email,_honey:''};
  if(kind==='diagnosis'){
    const diag=text(b.Diagnosis_Type,160);
    const note=text(b.Additional_Note,1800);
    if(hasTooManyUrls(note)) return json(res,400,{success:false,message:'Message rejected'});
    out={...out,
      _subject:`[홈페이지 원가 최적화 진단] ${company||name} / ${diag}`,
      Language:text(b.Language,10),Name:name,Company:company||'-',Email:email,Phone:phone,
      Diagnosis_Type:diag,Project_Stage:text(b.Project_Stage,160),Current_Cost:text(b.Current_Cost,120),
      Target_Cost:text(b.Target_Cost,120),Target_Saving:text(b.Target_Saving,120),Quantity:text(b.Quantity,200),
      Documents:text(b.Documents,200),Additional_Note:note||'-'
    };
  }else if(kind==='contact'){
    const msg=text(b.Message || b.message,2500);
    if(hasTooManyUrls(msg)) return json(res,400,{success:false,message:'Message rejected'});
    out={...out,
      _subject:`[홈페이지 문의] ${text(b.Inquiry_Type||b.type,120)} / ${company||name}`,
      Name:name,Company:company||'-',Email:email,Phone:phone,
      Inquiry_Type:text(b.Inquiry_Type||b.type,160),Message:msg
    };
  }else return json(res,400,{success:false,message:'Unknown form type'});

  try{
    const upstream=await fetch('https://formsubmit.co/ajax/contact@reduct.co.kr',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(out)
    });
    const data=await upstream.json().catch(()=>({}));
    if(!upstream.ok || data.success===false || data.success==='false') return json(res,502,{success:false,message:'Upstream submission failed'});
    return json(res,200,{success:true});
  }catch(e){
    console.error('REDUCT contact proxy error',e);
    return json(res,502,{success:false,message:'Submission service unavailable'});
  }
};
