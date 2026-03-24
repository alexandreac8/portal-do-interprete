# Portal do Intérprete

Portal de vagas para intérpretes e profissionais de Libras no Brasil.

Vagas atualizadas automaticamente todo dia às 7h via Claude AI com busca web.

## Stack

- Vercel Serverless Functions
- Vercel KV (armazenamento de vagas)
- Claude API com web search

## Variáveis de ambiente necessárias

- `ANTHROPIC_API_KEY` — chave da API do Claude
- `CRON_SECRET` — segredo para proteger o endpoint de atualização
- `KV_REST_API_URL` — fornecido pelo Vercel KV
- `KV_REST_API_TOKEN` — fornecido pelo Vercel KV
