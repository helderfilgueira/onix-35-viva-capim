# API do piloto Viva Capim

Base `/api/v2`; JSON. Todas as alterações, inclusive públicas, exigem cookie CSRF e cabeçalho `X-CSRFToken`. Primeiro `GET /api/v2/session`; resposta `{csrf_token, authenticated, user:null|{id,username,role,organization_id,organization_name}}`. Login retorna novo csrf_token. Sessões são cookies HttpOnly; sem credenciais em localStorage. Erros `{error,code}`. Coleções `{items:[...]}`. Sem barras finais.

## Identidade e resumo
- `POST /auth/login` `{username,password}` → contexto da sessão.
- `POST /auth/logout` `{}` → `{ok:true}`.
- `GET /overview` → `{role,organizations,events,benefits,redemptions,members,points_issued,points_redeemed,pending_approvals}`; contagens respeitam organização; members e pontos globais somente admin.
- `GET /organizations` admin lista todas; partner/cashier somente própria. `POST /organizations` admin `{name,kind:store|producer,store_id?:string}`. `PATCH /organizations/<id>` admin mesmos campos e `active`.
- `GET /staff` admin; `POST /staff` admin `{username,password,role:admin|partner|cashier,organization_id?:integer}`. `PATCH /staff/<id>` admin `{active?:bool,password?:string}`.

## Conteúdo e aprovação
- `GET/POST /events`; POST `{organization_id?,title,description,location,starts,ends,translations?:{en:{title,description},es:{title,description}}}`. Datas ISO com fuso. GET inclui `{id,organization_id,title,description,location,starts,ends,status,translations}`.
- `GET/POST /content`; POST `{organization_id?,kind:ad|campaign|easter_egg,title,description,starts,ends,translations?:{},theme?:string}`. `campaign` (campanha temática) e `easter_egg` são experiências de três descobertas, sem pontos. A **campanha de interesse com 5 pontos** é outra coisa: um cartão `ad` com `reward_enabled`, creditado só no balcão (ver seção de cartões e campanhas).
- `GET/POST /benefits`; POST `{organization_id?,title,description,points_cost:integer>=1,stock:integer>=0,translations?:{}}`.
- `PATCH /events/<id>`, `/content/<id>`, `/benefits/<id>` campos de edição; edição por parceiro volta a pending.
- `POST /events/<id>/approve`, `/content/<id>/approve`, `/benefits/<id>/approve` admin `{}`; `POST .../pause` admin ou parceiro próprio `{}`. Estados `pending`, `approved`, `paused`. Caixa não cria/edita.
- `GET /public/events`, `/public/content`, `/public/benefits`: somente aprovados, conteúdo temporal ativo, benefícios disponíveis, sem autenticação. Campos iguais aos públicos acima, sem autoria interna.

## Cartões, eventos públicos e campanhas (missão experiência)
- Eventos aceitam também `store_id` (destino do catálogo do mapa; coordenadas livres → 400 `invalid_destination`) e `all_day:bool`.
- Conteúdo `kind:ad` aceita `event_id` (evento da mesma organização), `store_id`, `position:0..999` e `reward_enabled:bool` (só em `ad`; padrão `false`). Qualquer edição volta a `pending`.
- `GET /public/cards?locale=pt-BR|en|es` → `{items:[{id,title,description,image_url,image_alt,theme,place:{id,name,floor_id,floor_name,route_available}|null,event:{id,title,description,starts,ends,all_day,state:scheduled|ongoing|ended|cancelled,location,place,url}|null,reward_points:5|null}],campaign_points:5}`; só cartões aprovados, vigentes e de organização ativa, ordenados por `position`; até 24.
- `GET /public/cards/<id>/image` → bytes da imagem (`image/png|jpeg|webp`, `nosniff`); 404 se o cartão não for público.
- `GET /public/events/<id>?locale=` → evento público (pendente → 404).
- Página `GET /evento/<id>/?lang=` (HTML sem JavaScript) e `GET /evento/<id>.ics?lang=` (`text/calendar`, RFC 5545; horários em UTC, dia inteiro com `VALUE=DATE` e fim exclusivo). Encerrado/cancelado: página informa o estado e `.ics` responde 410. Nenhum dado pessoal em URL ou arquivo. O link do Google Agenda (`calendar.google.com/calendar/render?action=TEMPLATE`) não tem documentação oficial pública; o `.ics` é a alternativa interoperável.
- `GET /counter/campaigns?member_id=` staff → campanhas com recompensa ativas no escopo do operador `{points,daily_cap,items:[{id,title,organization_name,ends,credited}]}`.
- `POST /counter/campaign-credit` staff `{member_id,content_id}` → 201 crédito novo / 200 já existente `{id,member_id,content_id,points,created_at}`. Valor (5) e limites ficam no servidor; campos extras → 400. Exige membro ativo, cartão aprovado/vigente/da organização do operador (admin: todas) e operação não pausada; teto diário → 409 `campaign_daily_cap`; indisponível → 409 `campaign_unavailable`. Confirmação assistida: não comprova posse do telefone.
- `POST /campaign-credits/<ledger_id>/reverse` admin `{reason}` → estorno único (201; repetição 200); não reabre a campanha; pontos já gastos → 409 `campaign_spent` (tratamento manual).
- `GET /overview` (admin) inclui `points_campaign`; `points_issued` soma avaliações e campanhas.

## Fidelidade
- `POST /members/register` público `{first_name,last_name,phone,age_18:true,consent:true,locale?:pt-BR|en|es}` → **sempre** `{ok:true,message:"Solicitação recebida. Procure o atendimento para ativação presencial."}` sem saldo/status/identificador. Telefone brasileiro ou internacional normalizado; dado não verificado por SMS. Cadastro existente não é alterado.
- `GET /members` admin somente → lista com id,nome,sobrenome,phone mascarado,status,balance,created_at.
- `POST /members/lookup` staff `{phone}` → `{member:null|{id,first_name,last_name,phone_masked,status,balance}}`; sem lista de clientes para parceiros.
- `POST /members/<id>/activate` admin `{confirmed_18:true}` → member ativado; telefone permanece não verificado. `POST /members/<id>/suspend` admin `{}`.
- `POST /reviews` público `{target_type:store|event,target_id:string,score:1..5,reason:string,phone?:string,consent:true}` → resposta genérica `{ok:true,message}` sem saldo/status do cadastro. Nota recebe 10 pontos independentemente de estrelas quando telefone corresponde a membro ativo; limite loja uma concessão em 30 dias, evento uma vez, máximo 30 pontos/dia. Sem telefone avaliação não gera pontos. Visita é autodeclarada, sem promessa de prova de presença. Risco de telefone não verificado documentado.
- `GET /ratings` admin/parceiro (não caixa) → `{items:[{target_type,target_id,count:null|integer,average:null|number,status}],threshold:5}` somente alvos da própria organização; admin todos. Sem linhas individuais ou identidade.
- `POST /redemptions` staff `{member_id,benefit_id,idempotency_key}` → `{id,member_id,benefit_id,title,points,status,created_at}`. Benefício deve pertencer à organização do operador (admin pode todas). Confirma entrega presencial imediatamente, debita saldo/estoque atomicamente. Sem resgate público. Repetição da mesma chave devolve mesmo resultado; chave com payload diferente 409.
- `GET /redemptions` staff escopo próprio; admin global.
- `POST /redemptions/<id>/reverse` admin `{reason}` estorna pontos e estoque uma única vez.
- `GET /members/<id>/ledger` admin; `POST /members/<id>/close` admin `{reason,forfeit_balance?:true}` encerra cadastro, remove nome/telefone e desativa concessões. Havendo saldo, exige renúncia expressa do titular e registra débito `closure`; não há ajuste arbitrário. Encerramento é terminal; repetição não altera a data.

### Complementos obrigatórios de publicação
- Benefícios também aceitam `starts`, `ends` ISO com fuso; necessários para aprovação e validade do resgate.
- Publicação exige `translations.en` e `.es` com `title` e `description`; conteúdo permanece pendente se incompleto.
- Conteúdo aceita `image_data` data URL PNG/JPEG/WebP de até 300KB, `image_alt`, `target_url` HTTPS; imagem persiste no banco. Imagem exige texto alternativo. `discoveries` é lista de exatamente três objetos `{id,title,translations:{en:{title},es:{title}}}` para campaign/easter_egg; não concede pontos.
- Reviews exigem também `visited:true` (autodeclaração). Ativação de cadastro é exclusiva admin; parceiros/caixas localizam membro e fazem resgate presencial.
- `GET /members/<id>/export` exclusivo admin para atendimento verificado aos direitos. Encerramento remove PII imediatamente; extrato permanece enquanto a conta opera, sem expiração automática de pontos, e é eliminado 180 dias após encerramento pelo comando `purge_pilot`. Avaliações e cadastros pendentes expiram após 30 dias; trilha administrativa após 180 dias; limitadores após dois dias sem uso. **Executar `python manage.py purge_pilot` diariamente por agendador da hospedagem: o servidor HTTP não executa essa manutenção automaticamente.** Política operacional sujeita à revisão antes de programa comercial.
- `GET /public/catalog` retorna `{benefits,events,stores,campaigns,ads}`. `stores` contém id/name das lojas da planta, `campaigns` contém campanhas/descobertas vigentes, `ads` anúncios vigentes.
- `GET /public/ratings?target_type=store&target_id=<id>` retorna `{items:[...],threshold:5}` sem identificação; lista vazia significa ausência de amostra.
- Reviews aceitam `idempotency_key` opcional; sem chave a sessão e o alvo deduplicam a submissão. Evento só aceita avaliações desde o início até 30 dias após o término. Concessões permanecem no extrato para impedir nova premiação do mesmo evento mesmo após a retenção das avaliações.
- Piloto limitado a 100 cadastros ativos/pendentes e cinco organizações ativas. Cadastro público retorna a mesma mensagem quando lotado; administração acompanha contagem. Telefone não é verificado, logo a atribuição de pontos por telefone informado tem risco residual de terceiro; resgates só são feitos por operador identificado no balcão.
- `PILOT_OPERATIONS_ENABLED=0` e reinício pausam cadastro, ativação, avaliação com telefone e resgates; consulta, avaliações sem telefone, direitos e estornos administrativos permanecem disponíveis. Retorno de operações pausadas: HTTP503/code `loyalty_paused`.

## Páginas
`/dashboard/` template de dashboard; `/participar/` UI pública em pilot/public; `/admin/` Django admin exclusivo superusuários. `/explorar.html` e assets legados compatíveis. `GET /api/navigation`, `POST /api/routes` mantêm contrato da planta. Não existem login, saldo ou resgate público por telefone. Operador atende no balcão; nenhum código OTP é exigido.
