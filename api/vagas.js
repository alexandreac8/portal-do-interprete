import { list } from "@vercel/blob";

const BLOB_KEY = "vagas.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  try {
    const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs.length) {
      return res.status(200).json({ vagas: [], atualizado: null, total: 0 });
    }
    const r = await fetch(`${blobs[0].url}?t=${Date.now()}`);
    if (!r.ok) {
      return res.status(200).json({ vagas: [], atualizado: null, total: 0 });
    }
    const dados = await r.json();
    return res.status(200).json(dados);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
