module.exports=async function(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const origin=process.env.FOURLEAF_API_ORIGIN;
 if(!origin)return res.status(503).json({error:'게임 서버 연결 준비 중'});
 try{
  const combos=req.query.view==='combos';const url=new URL(combos?'/api/combos':'/api/ranking',origin);
  if(url.protocol!=='https:')throw Error();
  const reply=await fetch(url,{headers:{'X-4LEAF-Proxy':process.env.FOURLEAF_API_PROXY_SECRET||''},signal:AbortSignal.timeout(5000)});
  if(!reply.ok)throw Error();const data=await reply.json();
  if(!Array.isArray(combos?data.combos:data.players))throw Error();
  return res.status(200).json(data);
 }catch{return res.status(503).json({error:'게임 서버에 연결할 수 없습니다.'});}
};
