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
const DEBUG = { eventos: [] };
function debug(msg) { DEBUG.eventos.push(msg); }

async function buscarVagas(prompt, hoje) {
  try {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: `Você é um caçador de vagas de Libras no Brasil. Use busca web pra encontrar vagas reais, publicadas nos últimos 30 dias.

IMPORTANTE: sua resposta DEVE ser APENAS um JSON válido, nada mais. Sem explicações, sem markdown, sem texto antes ou depois. Se não encontrar vagas perfeitas, traga as melhores que encontrou. É melhor trazer vagas com link da página de listagem do que não trazer nada.

Schema obrigatório:
{"vagas":[{"titulo":"cargo","empresa":"nome da empresa","local":"Cidade, UF ou Remoto","modalidade":"presencial|remoto|híbrido","descricao":"1-2 linhas","link":"url","data":"DD/MM/AAAA","data_iso":"AAAA-MM-DD"}]}

Regras:
- "data" no formato DD/MM/AAAA. Se não souber a data exata, use ${hoje}
- "data_iso" no formato AAAA-MM-DD (mesma data de "data"). Se não souber, use ${isoHoje()}
- "link": pode ser a URL específica da vaga OU a URL da página de listagem onde ela aparece
- Aceite tanto vagas individuais (gupy, infojobs etc) quanto editais de processo seletivo/concurso
- Não invente vagas: só inclua o que você realmente viu nos resultados de busca
- Se uma busca não der resultados bons, tente outros termos antes de desistir
- Sempre retorne o JSON, mesmo que vagas seja array curto. NUNCA retorne texto explicativo`,
    messages: [{ role: "user", content: prompt }]
  });

  let texto = "";
  const tiposBlock = [];
  for (const block of response.content) {
    tiposBlock.push(block.type);
    if (block.type === "text") texto += block.text;
  }
  debug({ tipo: "resposta_claude", stop_reason: response.stop_reason, blocks: tiposBlock, texto_inicio: texto.slice(0, 300) });
  const start = texto.indexOf("{");
  const end = texto.lastIndexOf("}");
  if (start === -1 || end === -1) {
    debug({ tipo: "sem_json_no_texto", texto: texto.slice(0, 500) });
    return [];
  }
  try {
    const parsed = JSON.parse(texto.slice(start, end + 1));
    const vagas = Array.isArray(parsed.vagas) ? parsed.vagas : [];
    debug({ tipo: "parse_ok", count: vagas.length });
    return vagas;
  } catch (e) {
    debug({ tipo: "parse_falhou", erro: e.message, texto: texto.slice(0, 500) });
    return [];
  }
  } catch (err) {
    debug({ tipo: "chamada_claude_falhou", erro: err.message, status: err.status, name: err.name });
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
      `Hoje é ${hoje}. Busque "vaga intérprete de libras" e "tradutor de libras" no Brasil, publicadas nos últimos 30 dias. Pesquise em Gupy, Vagas.com, Infojobs, Catho, LinkedIn, Indeed, sites de empresas de tecnologia assistiva. Traga 10 a 15 vagas reais, variadas em região e modalidade (presencial, remoto, híbrido). Retorne APENAS o JSON conforme schema.`,
      `Hoje é ${hoje}. Busque "professor de libras" e "instrutor de libras" em concursos públicos e processos seletivos no Brasil dos últimos 30 dias. Pesquise em PCI Concursos, Folha Dirigida, sites de prefeituras, secretarias de educação estaduais, IFs (institutos federais), UFs (universidades federais). Traga 10 a 15 editais reais. Retorne APENAS o JSON.`,
      `Hoje é ${hoje}. Busque vagas REMOTAS de Libras: intérprete remoto, tradutor de libras EAD, professor online de libras, freelancer libras no Brasil. Publicadas últimos 30 dias. Pesquise em Gupy, Vagas.com, plataformas de EAD (Unicesumar, Ânima, Cogna), Indeed remoto. Traga 8 a 12 vagas remotas reais. Retorne APENAS o JSON.`,
      `Hoje é ${hoje}. Busque vagas EDUCACIONAIS de libras: intérprete educacional, intérprete escolar, mediador de libras em escolas e universidades brasileiras. Últimos 30 dias. Pesquise sites de secretarias municipais e estaduais de educação, SEDUC, redes privadas de ensino (Ânima Educação, Cogna, Yduqs, Vitru). Traga 8 a 12 vagas reais. Retorne APENAS o JSON.`
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
      blob_url: url,
      debug: DEBUG.eventos
    });
  } catch (err) {
    console.error("ERRO handler:", err.message, err.stack);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
