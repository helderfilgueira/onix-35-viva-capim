# Pesquisa aplicada · 14/11/2026

Fontes primárias consultadas para orientar decisões. Não são prova de implementação, homologação ou adequação jurídica do Viva Capim.

| Fonte | Aplicação no projeto |
|---|---|
| [Django 5.2: autenticação e permissões](https://docs.djangoproject.com/en/5.2/topics/auth/default/) | Reutilizar usuários, sessões e permissões; escopo por parceiro continua responsabilidade do código de domínio |
| [Django: checklist de deploy](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/) | Separar desenvolvimento/produção e verificar segredo, DEBUG, hosts, HTTPS e cookies antes de publicar |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Critérios testáveis para teclado, foco, contraste, redimensionamento e interação; executar avaliação, não declarar certificação por usar componentes |
| [VLibras oficial](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/vlibras) | Candidato de tradução assistiva de conteúdo público em português; não presumir cobertura de outras línguas de sinais ou equivalência à interpretação humana |
| [ANPD: perguntas frequentes](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes) | Retenção depende de finalidade/contexto; definir política de fidelidade separada e canal de direitos |
| [LGPD: texto atualizado na Câmara](https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-normaatualizada-pl.html) | Finalidade, necessidade, transparência e direitos orientam separação entre navegação pública, avaliação e fidelidade identificada |

A fonte Planalto tentou redirecionar para desafio de acesso nesta consulta; foi usada a publicação legislativa da Câmara como referência alternativa. Os links técnicos correspondem à versão Django escolhida, não à alegação de que ela é a versão mais recente.

## Decisões de engenharia derivadas

Dashboard por papel e organização; autenticação no servidor; benefício por participação sem depender da nota; carteira global com lançamentos auditáveis; dados de avaliação separados do cadastro; missão sazonal com três descobertas sem pontos; alternativa acessível à interação 3D. São decisões do projeto, não recomendações atribuídas literalmente às fontes.

O usuário escolheu Vercel + Supabase; Docker permanece alternativa portável. Limites comerciais, suspensão, disponibilidade regional e retenção de backups precisam de verificação no provisionamento; este documento não fixa valores comerciais. O estado operacional confirmado é registrado separadamente no roteiro de deploy.

## Fontes da hospedagem escolhida

- [Django na Vercel](https://vercel.com/docs/frameworks/full-stack/django): suporte nativo e CLI mínima 50.38.0, conforme consulta de 14/11/2026.
- [Supabase: conexão PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres): pooler em modo transacional para conexões serverless; configurar o driver sem prepared statements incompatíveis.
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): proteger tabelas expostas; o piloto não usa acesso direto do cliente ao banco.
- [Vercel: gestão de Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs): invocações protegidas por `CRON_SECRET`; mudanças de segredo precisam de redeploy e verificação do disparo.
- [Changelog Supabase](https://supabase.com/changelog.md): índice consultado para identificar mudanças relevantes antes da configuração.

Essas páginas descrevem capacidades e práticas do provedor; não comprovam que o projeto do Viva Capim foi criado, conectado ou publicado.
