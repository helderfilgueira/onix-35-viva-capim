# Deploy escolhido · Django na Vercel + PostgreSQL no Supabase

## Decisão e estado externo

Escolha explícita do usuário em 14/11/2026. Usar Django no suporte nativo da Vercel; a documentação oficial indica Vercel CLI 50.38.0 ou superior. Preservar o laboratório e servir seus assets/rotas pela integração do piloto. Docker continua alternativa portável; Render/Neon não são o destino selecionado.

A organização Supabase foi identificada e a criação gratuita autorizada, mas a ferramenta informou limite de dois projetos gratuitos ativos. Nenhum projeto existente foi pausado, alterado ou removido. A decisão sobre liberar vaga está pendente do usuário. Não publicar identificadores, nomes de projetos alheios, credenciais ou URLs de conexão neste registro público. Não declarar URL do Viva Capim funcionando antes do deploy verificado.

## Configuração do banco

Criar projeto isolado somente quando houver vaga autorizada. Copiar a conexão do pooler transacional disponibilizada pelo Supabase; não inferir hostname pelo nome da região. `DATABASE_URL` e senha ficam no ambiente do backend. Não usar chaves Supabase no navegador, nem adicionar SDK cliente ou Supabase Auth para este fluxo.

O driver deve desativar prepared statements incompatíveis com o pooler transacional e não depender de cursores/estado de sessão entre transações. SSL obrigatório. Executar migrações em etapa operacional controlada, nunca a cada requisição. Testar créditos/resgates concorrentes no PostgreSQL de destino.

Habilitar RLS nas tabelas de schemas expostos e negar acesso direto pelos papéis `anon` e `authenticated` às tabelas Django/piloto. Essa barreira protege a Data API; autorização por organização e papel continua no Django. Verificar permissões efetivas com consultas negativas após migração. Não afirmar proteção concluída somente por ter escrito SQL/migração.

## Vercel e rotina diária

Configurar projeto/equipe corretos e registrar commit/ambiente. Usar o entrypoint e as dependências realmente presentes no repositório. Definir segredo Django exclusivo, `DEBUG` desativado, hosts/origens corretos, conexão privada e cookies HTTPS. Não expor banco ou credenciais no build, cliente, logs ou URLs.

A configuração de Vercel Cron deve invocar diariamente a rota de retenção declarada no código/configuração, protegida por `CRON_SECRET`. Rejeitar segredo ausente/incorreto; não tratar essa rota como endpoint público de manutenção. Depois de configurar ou rotacionar o segredo, publicar novamente e verificar resultado real. A rotina cobre avaliações e pendentes de 30 dias; ledger ativo é mantido e dados de cadastro encerrado são expurgados após 180 dias do encerramento, conforme política.

Validar preview e produção separadamente, incluindo arquivos estáticos, mapa, CSRF, sessão, dois parceiros, balcão e retenção. Não promover para dados reais enquanto controlador/canal de direitos, backup/restauração e operação não estiverem definidos. Registrar falhas de quota, autenticação ou build sem contorná-las usando projetos de terceiros.

## Referências verificadas

[Django na Vercel](https://vercel.com/docs/frameworks/full-stack/django) · [Conexão PostgreSQL Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) · [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
