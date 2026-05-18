import Anthropic from "@anthropic-ai/sdk";
import { put, list } from "@vercel/blob";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const config = { maxDuration: 300 };

const BLOB_KEY = "vagas.json";
const META_VAGAS = 30;
const DIAS_VALIDADE = 30;

// ===== util =====
function hojeBR() {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo"
  });
  return fmt.format(new Date());
}

function isoHoje() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Sao_Paulo"
  });
  return fmt.format(new Date());
}

function diasEntre(isoA, isoB) {
  const a = new Date(`${isoA}T12:00:00Z`).getTime();
  const b = new Date(`${isoB}T12:00:00Z`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function parseDataIso(vaga) {
  if (vaga.data_iso && /^\d{4}-\d{2}-\d{2}$/.test(vaga.data_iso)) return vaga.data_iso;
  const raw = (vaga.data || "").trim();
  if (!raw) return null;
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return raw;
  const meses = {
    janeiro: "01", fevereiro: "02", marco: "03", "março": "03", abril: "04",
    maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09",
    outubro: "10", novembro: "11", dezembro: "12"
  };
  const m3 = raw.toLowerCase().match(/^([a-zçãéí]+)\/(\d{4})$/i);
  if (m3 && meses[m3[1]]) return `${m3[2]}-${meses[m3[1]]}-01`;
  return null;
}

// ===== blob io =====
async function lerVagasBlob() {
  try {
    const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
    if (!blobs.length) return { vagas: [], atualizado: null, total: 0 };
    const r = await fetch(`${blobs[0].url}?t=${Date.now()}`);
    if (!r.ok) return { vagas: [], atualizado: null, total: 0 };
    return await r.json();
  } catch {
    return { vagas: [], atualizado: null, total: 0 };
  }
}

async function salvarNoBlob(dados) {
  const json = JSON.stringify(dados, null, 2);
  const result = await put(BLOB_KEY, json, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });
  return result.url;
}

// ===== claude =====
async function buscarVagas(prompt, hoje) {
  try {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `Você é um caçador de vagas de Libras no Brasil. Use busca web pra encontrar vagas REAIS, publicadas nos últimos 30 dias.

Retorne SOMENTE um JSON válido (sem markdown, sem texto extra). Schema:
{"vagas":[{"titulo":"cargo","empresa":"nome da empresa","local":"Cidade, UF ou Remoto","modalidade":"presencial|remoto|híbrido","descricao":"1-2 linhas claras","link":"url direta da vaga","data":"DD/MM/AAAA","data_iso":"AAAA-MM-DD"}]}

Regras importantes:
- "data" sempre no formato DD/MM/AAAA (data de publicação real, não a data de hoje)
- "data_iso" sempre no formato AAAA-MM-DD (mesma data de "data")
- Se não souber a data exata da vaga, use a data de hoje: ${hoje} (DD/MM) e ${isoHoje()} (ISO)
- Descarte qualquer vaga com mais de 30 dias
- O link deve ser direto pra página da vaga, não home do site
- Não invente vagas. Só inclua as que você realmente encontrou via web search`,
    messages: [{ role: "user", content: prompt }]
  });

  let texto = "";
  for (const block of response.content) {
    if (block.type === "text") texto += block.text;
  }
  const start = texto.indexOf("{");
  const end = texto.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(texto.slice(start, end + 1));
    return Array.isArray(parsed.vagas) ? parsed.vagas : [];
  } catch (e) {
    console.log("falha parse:", e.message, "| texto recebido (200 chars):", texto.slice(0, 200));
    return [];
  }
  } catch (err) {
    console.log("falha chamada Claude:", err.message, err.status || "");
    return [];
  }
}

// ===== handler =====
export default async function handler(req, res) {
  const auth = req.headers["authorization"];
  const cronHeader = req.headers["x-vercel-cron"];
  if (!cronHeader && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "não autorizado" });
  }

  try {
    const hoje = hojeBR();
    const hojeIso = isoHoje();

    const dadosAtuais = await lerVagasBlob();
    const vagasAtuais = Array.isArray(dadosAtuais.vagas) ? dadosAtuais.vagas : [];

    const vagasValidas = vagasAtuais
      .map(v => ({ ...v, data_iso: parseDataIso(v) }))
      .filter(v => {
        if (!v.data_iso) return false;
        const idade = diasEntre(v.data_iso, hojeIso);
        return idade >= 0 && idade <= DIAS_VALIDADE;
      });

    const prompts = [
      `Hoje é ${hoje}. Busque vagas de INTÉRPRETE DE LIBRAS, tradutor de Libras e intérprete educacional no Brasil publicadas nos últimos 30 dias. Pesquise em LinkedIn, Indeed, Catho, Vagas.com, Infojobs, Gupy. Traga no mínimo 10 vagas reais, variadas em região. Inclua presencial, remoto e híbrido. Retorne SOMENTE o JSON no schema definido.`,
      `Hoje é ${hoje}. Busque vagas de PROFESSOR DE LIBRAS, INSTRUTOR DE LIBRAS e processos seletivos/concursos no Brasil publicados nos últimos 30 dias. Pesquise em sites de prefeituras, IFs, universidades e secretarias de educação. Traga no mínimo 10 vagas reais. Retorne SOMENTE o JSON no schema definido.`
    ];

    const lotes = await Promise.allSettled(prompts.map(p => buscarVagas(p, hoje)));
    lotes.forEach((l, i) => {
      if (l.status === "rejected") console.log(`lote ${i} REJECTED:`, l.reason?.message || l.reason);
      else console.log(`lote ${i} ok, ${l.value.length} vagas`);
    });
    const vagasNovas = lotes
      .filter(l => l.status === "fulfilled")
      .flatMap(l => l.value)
      .map(v => ({ ...v, data_iso: parseDataIso(v) }))
      .filter(v => v.data_iso && diasEntre(v.data_iso, hojeIso) <= DIAS_VALIDADE);
    console.log(`vagasNovas (apos filtro): ${vagasNovas.length} | vagasValidas anteriores: ${vagasValidas.length}`);

    const todas = [...vagasValidas, ...vagasNovas];
    const vistos = new Set();
    const unicas = [];
    for (const v of todas) {
      const chave = (v.link || `${v.titulo}|${v.empresa}|${v.local}`).toLowerCase().trim();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      unicas.push(v);
    }

    unicas.sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""));

    let finais = unicas;
    if (finais.length < META_VAGAS) {
      const antigas = vagasAtuais
        .map(v => ({ ...v, data_iso: parseDataIso(v) }))
        .filter(v => v.data_iso)
        .sort((a, b) => (b.data_iso || "").localeCompare(a.data_iso || ""));
      for (const v of antigas) {
        if (finais.length >= META_VAGAS) break;
        const chave = (v.link || `${v.titulo}|${v.empresa}|${v.local}`).toLowerCase().trim();
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        finais.push(v);
      }
    }

    const dados = {
      vagas: finais,
      atualizado: hoje,
      total: finais.length,
      meta: META_VAGAS,
      validade_dias: DIAS_VALIDADE
    };

    const url = await salvarNoBlob(dados);
    return res.status(200).json({
      ok: true,
      total: dados.total,
      novas_encontradas: vagasNovas.length,
      mantidas_anteriores: vagasValidas.length,
      atualizado: dados.atualizado,
      blob_url: url
    });
  } catch (err) {
    console.error("ERRO handler:", err.message, err.stack);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
