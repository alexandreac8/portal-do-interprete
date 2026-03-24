export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  try {
    const { kv } = await import("@vercel/kv");
    const dados = await kv.get("vagas_libras");
    if (!dados) return res.status(200).json({ vagas: [], atualizado: null, total: 0 });
    const parsed = typeof dados === "string" ? JSON.parse(dados) : dados;
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
