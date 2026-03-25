const RAW_URL = "https://raw.githubusercontent.com/alexandreac8/portal-do-interprete/main/data/vagas.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  try {
    const r = await fetch(`${RAW_URL}?t=${Date.now()}`);
    if (!r.ok) return res.status(200).json({ vagas: [], atualizado: null, total: 0 });
    const dados = await r.json();
    return res.status(200).json(dados);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
