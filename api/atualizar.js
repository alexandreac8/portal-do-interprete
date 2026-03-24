import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  const cronHeader = req.headers["x-vercel-cron"];
  if (!cronHeader && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "não autorizado" });
  }
  try {
    const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: `Você busca vagas de emprego na área de Libras no Brasil usando busca web. Retorne SOMENTE um JSON válido, sem markdown, sem texto extra. Formato exato: {"vagas":[{"titulo":"cargo","empresa":"nome","local":"cidade ou Remoto","modalidade":"presencial|remoto|híbrido","descricao":"descrição em 1-2 linhas","link":"url","data":"data de publicação"}],"atualizado":"${hoje}","total":0}`,
      messages: [{ role: "user", content: `Busque hoje (${hoje}) vagas de emprego, estágios e freelancer na área de Libras no Brasil. Pesquise em LinkedIn, Indeed, Catho, Infojobs, sites de prefeituras e institutos federais. Termos: intérprete de Libras, professor de Libras, instrutor de Libras, instrutor surdo, tradutor Libras. Traga no mínimo 10 vagas reais e atuais. Retorne SOMENTE o JSON.` }]
    });
    let textoFinal = "";
    for (const block of response.content) {
      if (block.type === "text") textoFinal += block.text;
    }
    const start = textoFinal.indexOf("{");
    const end = textoFinal.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("JSON não encontrado");
    const dados = JSON.parse(textoFinal.slice(start, end + 1));
    dados.total = dados.vagas?.length || 0;
    const { kv } = await import("@vercel/kv");
    await kv.set("vagas_libras", JSON.stringify(dados));
    return res.status(200).json({ ok: true, total: dados.total, atualizado: dados.atualizado });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
