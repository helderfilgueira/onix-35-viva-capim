# Evidências do piloto · 14/11/2026

Registro de resultados observados, separado da aprovação para dados reais. Código atual e CI: `19c8dbbda96805173f36490a21c837e8b700983b`, branch `feat/dashboard-fidelidade`. [PR #18 aberto como Draft](https://github.com/helderfilgueira/onix-35-viva-capim/pull/18), com revisão pendente. As verificações de UI registradas começaram na baseline `7e78d09`; regressões finais e checks de backend foram executados no commit corrigido indicado. Alterações posteriores de UI/configuração exigem seus próprios checks; este relatório não transfere sucesso automaticamente para outro commit.

## Testes automatizados

| Verificação | Resultado e evidência |
|---|---|
| Django com PostgreSQL | **56 testes aprovados, sem skips**, incluindo permissões e regras de negócio. [Execução 43557578176](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43557578176). Checks Django, ausência de migrações faltantes e sintaxe JavaScript também passaram nessa execução. |
| Regressão do laboratório | **66 testes aprovados**. [Execução 43557578332](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43557578332). |
| Mapa integrado ao Django | Verificação de navegador local aprovada: rota entre pisos, seleção de piso, bloqueio de acesso sem degraus não comprovado, elevador a partir da porta explícita e abertura da nova avaliação da loja. A verificação local está separada da verificação em nuvem abaixo. |

Os resultados CI foram conferidos no GitHub Actions; as duas execuções atuais acima estão aprovadas no commit final indicado. Nenhuma dessas evidências é inspeção física do shopping.

## Jornadas de interface e nuvem

| Verificação | Evidência e limite |
|---|---|
| Dashboard CRUD | **11 verificações aprovadas**: criação/aprovação, edição, pausa, cadastro/ativação, avaliação com pontos, resgate, estorno e encerramento. [QA_DASHBOARD_CRUD.json](QA_DASHBOARD_CRUD.json). |
| Papéis e menus | **6 verificações aprovadas**, incluindo parceiro/caixa, acesso negado ao cadastro global e desativação das contas temporárias. [QA_DASHBOARD_ROLES.json](QA_DASHBOARD_ROLES.json). |
| Interface administrativa | **14 verificações aprovadas** de seções, pt/en/es, menu em 390px e logout. [QA_DASHBOARD_VISUAL.json](QA_DASHBOARD_VISUAL.json). |
| VLibras | Script oficial e avatar visual confirmados com headers reais, sem violações CSP registradas. Qualidade linguística não avaliada; seletor automático do avatar ficou inconclusivo por shadow DOM. [QA_VLIBRAS_VISUAL.json](QA_VLIBRAS_VISUAL.json). |
| Mapa na nuvem | **5 verificações aprovadas** de rotas, pisos, acessibilidade e encaminhamento à avaliação. [QA_MAPA_NUVEM.json](QA_MAPA_NUVEM.json). |
| Fidelidade pela API na nuvem | **9 verificações aprovadas** no domínio canônico: CSRF/login, cadastro/ativação, nota de uma estrela creditando dez pontos, resgate, repetição idempotente, estorno, recusa de resgate público e encerramento do membro de teste. [QA_NUVEM_FIDELIDADE.json](QA_NUVEM_FIDELIDADE.json). |
| Dashboard na nuvem | **14 verificações aprovadas**, sem erros JavaScript ou HTTP registrados. [QA_DASHBOARD_NUVEM.json](QA_DASHBOARD_NUVEM.json). |
| Jornada pública na nuvem | **5 verificações aprovadas**, incluindo catálogo, idiomas, cadastro CSRF, avaliação, novo atendimento e mobile; sem erros JavaScript registrados. [QA_PUBLICO_NUVEM.json](QA_PUBLICO_NUVEM.json). |
| Exportação administrativa | **5 verificações aprovadas**: download de JSON, nome genérico de arquivo, ausência de PII em URL/localStorage e rótulos pt/en/es. [QA_EXPORTACAO_UI.json](QA_EXPORTACAO_UI.json). |

Demonstração publicada: [site público](https://onix35-viva-capim.vercel.app/participar/), [dashboard](https://onix35-viva-capim.vercel.app/dashboard/) e [mapa](https://onix35-viva-capim.vercel.app/explorar.html). O empacotamento dos assets públicos foi corrigido e os cenários de navegador na nuvem passaram. O último commit de configuração/exportação e seu redeploy final devem permanecer rastreáveis separadamente; não atribuir automaticamente à baseline acima um SHA posterior. A publicação para demonstração não libera dados reais nem encerra a revisão do PR.

## Supabase remoto

O projeto gratuito `onix35-viva-capim`, em São Paulo, está criado. Conexão, migrações e seed remoto de demonstração foram concluídos pela integração. Verificação do catálogo PostgreSQL encontrou **22 tabelas**, todas de propriedade do papel `onix_django`, com RLS habilitada e privilégio `SELECT` falso para `anon` e `authenticated`. Não foram versionadas credenciais, senhas, banco ou conexão.

A verificação Security Advisors retornou somente informação `rls_enabled_no_policy`, sem achados WARNING/ERROR. A ausência de políticas permissivas é intencional: o banco do piloto é acessado pelo backend Django, sem leitura direta do cliente pela Data API. Isso não significa que RLS substitua autorização dentro do Django, nem constitui certificação de segurança. Referência: [Supabase Advisor 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).


## Revisão final e regressões

Revisão independente executada com Claude Opus 5.5 (`claude-opus-5-5`), sem troca de modelo, seguida de correções no commit `f70590b4df85522360eae4d84acbe6cc7021a56d`: normalização dos identificadores de eventos, limites de administração de contas e recuperação de sessão após revogação de acesso. Os detalhes de reprodução não foram publicados neste relatório. Seis regressões dirigidas foram aprovadas localmente com SQLite; isso não substitui os checks PostgreSQL.

O tratamento de IP no ambiente Vercel recebeu quatro testes específicos para o limitador de requisições, mantendo a distinção entre ambiente confiável e cabeçalhos enviados pelo cliente. Verificação manual da manutenção: chamada autenticada com segredo retornou 200 e chamada sem segredo retornou 401. O primeiro disparo automático agendado ainda não foi observado.

O redeploy final foi confirmado: deployment `dpl_3J9fFbuuLLjezkmh1CrNTWzfhFkC`, aplicação no commit `f70590b`. Saúde, 15 endpoints/assets, login/CSRF, isolamento, manutenção protegida, exportação na interface e rejeição de identificador inválido foram verificados. Evidência: [VERCEL_PUBLICACAO.json](VERCEL_PUBLICACAO.json). Esse registro corresponde à publicação indicada; o novo ajuste de Libras abaixo tem validação e publicação separadas.

## Incremento de Libras · validação local

Botão flutuante azul de 50×50 px, com duas mãos brancas, na lateral direita do catálogo público. Abre modal de consentimento antes de carregar o serviço externo; após ativação, transfere o controle ao botão nativo do VLibras sem duplicar controles.

**Sete verificações locais aprovadas:** ausência de carga externa antes do aceite; teclado/Escape/retorno de foco; falha com nova tentativa; carregamento real e transição ao widget nativo; modal em inglês e espanhol com orientação para português e ativação bloqueada nesses idiomas; ausência no cadastro com dados pessoais. Inspeção visual de desktop/mobile e modal registrada. Evidência: [QA_LIBRAS_FLUTUANTE.json](QA_LIBRAS_FLUTUANTE.json).

O incremento está no commit de aplicação `381c3c395a4dd8825dced1e3720c21935840692f`; seu redeploy foi confirmado em `dpl_EpjcYSYzpS2wpe57yFhLAAqs4R6m`. Os sete testes do botão também passaram no site publicado: [QA em nuvem](QA_LIBRAS_FLUTUANTE_NUVEM.json). A qualidade linguística da tradução automática continua não avaliada; Libras é língua de sinais brasileira e o recurso usa o conteúdo em português.

## Ajuste posterior · ciclo do VLibras e inatividade

Quatro regressões locais do ciclo do widget passaram com resposta controlada e relógio do Playwright: timeout/erro após fechar, retry sem reinjetar script, callbacks obsoletos após rerender e chegada tardia do widget sem duplicata ou perda de foco. A integração real do widget continua registrada separadamente nos sete testes anteriores. Evidência: [QA_LIBRAS_CICLO_VIDA.json](QA_LIBRAS_CICLO_VIDA.json).

A pedido do usuário, **inatividade automática somente em `/explorar.html`**. Seis verificações locais passaram para catálogo, cadastro e avaliação: cinco minutos sem modal/recarregamento/limpeza automática e encerramento manual funcionando. No mapa publicado, quatro verificações passaram: aviso após 90 segundos, Continuar, reaparecimento após novo período ocioso e encerramento que reinicia o mapa. Evidências: [páginas públicas](QA_INATIVIDADE_SOMENTE_MAPA_PUBLICO.json) e [mapa publicado](QA_INATIVIDADE_MAPA.json).

Este ajuste pertence ao commit de aplicação `381c3c395a4dd8825dced1e3720c21935840692f`, separado dos commits documentais. O redeploy correspondente foi confirmado, com seis verificações de inatividade também aprovadas no site publicado: [QA em nuvem](QA_INATIVIDADE_PUBLICO_NUVEM.json). Evidência de publicação: [VERCEL_LIBRAS.json](VERCEL_LIBRAS.json). Os relatórios da versão anterior foram preservados. A expiração de sessão administrativa no servidor permanece independente.

## Incremento posterior · Libras no mapa e botões de idioma

Decisão aplicada localmente: botão flutuante de Libras também no mapa `/explorar.html`, com componente isolado reutilizável pelo laboratório independente. O catálogo mantém seu fluxo; cadastro, avaliação e dashboard não recebem widget externo. CSP admite os domínios do recurso somente no catálogo e mapa, tanto na integração Django quanto no mapa legado.

As três páginas públicas já traduzidas passaram a usar botões PT/EN/ES. O dashboard mantém o seletor anterior; o mapa continua em português, sem promessa de tradução. Trocar idioma limpa dados não enviados do formulário conforme o aviso da interface.

**15 verificações locais aprovadas** cobrem widget real no mapa após opt-in, ausência de carga externa anterior, Escape/foco, reset do modal, botões nas três páginas e ausência de erros JavaScript. **Quatro verificações de inatividade do mapa passaram**, preservando aviso, Continuar, repetição do período e encerramento; o modal Libras não bloqueia esse fluxo. Evidências: [mapa/Libras/idiomas](QA_MAPA_LIBRAS_IDIOMAS.json) e [inatividade integrada](QA_MAPA_LIBRAS_IDLE.json). As rotas integradas também foram revalidadas pelo coordenador.

Testes direcionados executados: um teste CSP Django e 22 testes do conjunto legado pertinente aprovados. As suítes completas atuais passaram no commit `19c8dbb`: 56 testes PostgreSQL e 66 do legado, com links acima. Esse resultado não atribui o SHA novo ao deployment anterior.

## Correção final · novo atendimento e ciclo de rede do VLibras

No commit `19c8dbbda96805173f36490a21c837e8b700983b`, Novo atendimento no mapa com VLibras carregando ou carregado recarrega uma URL limpa, descarrega o terceiro e exige novo opt-in. Sem plugin iniciado, continua o reset habitual. Falha de rede após timeout remove o script inválido antes de nova tentativa; ao fechar consentimento, o foco permanece no diálogo de inatividade quando ele estiver aberto.

**Cinco regressões locais aprovadas** cobrem falha tardia/retry no catálogo e mapa, reset com widget carregando e carregado, e foco do alerta. Usaram relógio/rede controlados; RAF foi desligado somente nos testes temporais, não no produto. Evidência: [QA_LIBRAS_RESET_PRIVACIDADE.json](QA_LIBRAS_RESET_PRIVACIDADE.json). Esse complemento não substitui os 15 testes de mapa/idiomas, os quatro do fluxo de inatividade ou a inspeção visual anterior.

CI atual confirmado para o mesmo SHA: PostgreSQL **56 sem skips** e legado **66**. A promoção canônica foi confirmada no deployment `dpl_Hi1n7kXBebR87kRRSw5dbHZzQvBD`, aplicação `19c8dbb`. Os sete endpoints/headers/arquivos e 15 cenários de navegador publicados passaram: [publicação](VERCEL_MAPA_LIBRAS_IDIOMAS.json) e [QA online](QA_MAPA_LIBRAS_IDIOMAS_NUVEM.json). Commits posteriores apenas documentam essa publicação.

## O que ainda não está comprovado

- Primeiro disparo real de retenção agendada e monitoramento operacional do cron.
- Backup/restauração testados e canal/controlador real para atendimento de direitos.
- Revisão humana/aprovação do PR, teste com participantes e validação presencial da acessibilidade do shopping.

Continuar com dados fictícios. O piloto sem OTP não comprova posse do telefone. Pontuação é igual para qualquer nota, resgate é assistido e nenhuma avaliação antiga gera crédito retroativo.


## Mapa em PT / EN / ES · aplicação be2a340

Botões no cabeçalho atualizam menus, categorias, informações de lojas, serviços, legendas 2D/3D e instruções entre pisos. Os 1.058 textos do catálogo têm versões EN/ES, cobrindo 1.674 ocorrências; 138 nomes comerciais foram preservados. Catálogos são servidos localmente, sem serviço externo de tradução em tempo de uso. Tradução assistida por Claude Opus 5.5, validação técnica independente; revisão por falantes nativos ainda não realizada.

A troca mantém origem, destino, piso, visualização, busca, categoria e preferência acessível. Os testes compararam os segmentos desenhados antes/depois e verificaram ausência de nova requisição de rota. Não altera posições, geometria ou certeza dos acessos. Avaliações multilíngues usam o adapter do piloto Django; o formulário antigo do laboratório permanece separado. VLibras continua PT→Libras, com explicação EN/ES e ocultação do widget nesses idiomas sem perder a rota.

QA local: [10 verificações de integração](QA_MAPA_IDIOMAS.json), [8 de conteúdo/estado/mobile](QA_MAPA_CONTEUDO_IDIOMAS.json), [5 de ciclo VLibras](QA_MAPA_LIBRAS_I18N_ISOLADO.json) e [cobertura do catálogo](QA_MAPA_CONTEUDO_I18N.json) aprovadas. Legado: 69 testes aprovados. Django local: 56 testes encontrados, 50 aprovados e seis ignorados por dependerem de PostgreSQL; resultado CI no banco alvo e publicação serão registrados abaixo.

Publicação confirmada: `dpl_AMYG9nsriESMcnYnqdQ7hUKzuydp`, aplicação `be2a340`. CI PostgreSQL: 56 aprovados sem skips; legado: 69 aprovados. [Smoke publicado](VERCEL_MAPA_I18N.json) e [10 verificações de navegador na nuvem](QA_MAPA_IDIOMAS_CLOUD.json) passaram, incluindo tradução e preservação da rota acessível. Commits posteriores somente documentais.
