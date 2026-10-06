module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const origin = process.env.FOURLEAF_API_ORIGIN;
  if (!origin) return res.status(503).json({error:'게임 서버 연결 준비 중'});
  try {
    const url = new URL('/api/market', origin);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    const upstream = await fetch(url, {
      headers: {'X-4LEAF-Proxy':process.env.FOURLEAF_API_PROXY_SECRET || ''},
      signal:AbortSignal.timeout(5000)
    });
    if (!upstream.ok) throw new Error('Unavailable');
    const data = await upstream.json();
    if (!Array.isArray(data.cards)) throw new Error('Invalid catalogue');
    return res.status(200).json({updated_at:data.updated_at,stock_mode:data.stock_mode,
      cards:data.cards.map(c=>({code:c.code,name:c.name,price:c.price,stock:c.stock}))});
  } catch { return res.status(503).json({error:'게임 서버에 연결할 수 없습니다.'}); }
};
