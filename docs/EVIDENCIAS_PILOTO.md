# Evidências do piloto · 14/11/2026

Registro de resultados observados, separado da aprovação para dados reais. Código final das correções e CI: `f70590b4df85522360eae4d84acbe6cc7021a56d`, branch `feat/dashboard-fidelidade`. [PR #18 aberto como Draft](https://github.com/helderfilgueira/onix-35-viva-capim/pull/18), com revisão pendente. As verificações de UI registradas começaram na baseline `7e78d09`; regressões finais e checks de backend foram executados no commit corrigido indicado. Alterações posteriores de UI/configuração exigem seus próprios checks; este relatório não transfere sucesso automaticamente para outro commit.

## Testes automatizados

| Verificação | Resultado e evidência |
|---|---|
| Django com PostgreSQL | **55 testes aprovados, sem skips**, incluindo permissões e regras de negócio. [Execução 43554037413](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43554037413). Checks Django, ausência de migrações faltantes e sintaxe JavaScript também passaram nessa execução. |
| Regressão do laboratório | **65 testes aprovados**. [Execução 43554037557](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43554037557). |
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

O redeploy final deve corresponder ao commit corrigido e ser confirmado no relatório de publicação; não atribuir o SHA novo a uma verificação de deployment anterior.

## O que ainda não está comprovado

- Alinhamento do último commit de configuração/exportação com o redeploy final e seus checks. A demonstração já está publicada e as jornadas em nuvem acima foram verificadas.
- Primeiro disparo real de retenção agendada e monitoramento operacional do cron.
- Backup/restauração testados e canal/controlador real para atendimento de direitos.
- Revisão humana/aprovação do PR, teste com participantes e validação presencial da acessibilidade do shopping.

Continuar com dados fictícios. O piloto sem OTP não comprova posse do telefone. Pontuação é igual para qualquer nota, resgate é assistido e nenhuma avaliação antiga gera crédito retroativo.
