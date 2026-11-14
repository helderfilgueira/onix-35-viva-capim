# Evidências do piloto · 14/11/2026

Registro de resultados observados, separado da aprovação para dados reais. Referência do código testado em CI: `4ffec7dcfec2ac7ae04a19872a2ddceaf1258ac6`, branch `feat/dashboard-fidelidade`. Alterações posteriores de UI/configuração exigem seus próprios checks; este relatório não transfere sucesso automaticamente para outro commit.

## Testes automatizados

| Verificação | Resultado e evidência |
|---|---|
| Django com PostgreSQL | **45 testes aprovados, sem skips**, incluindo permissões e regras de negócio. [Execução 43552184111](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43552184111). Checks Django, ausência de migrações faltantes e sintaxe JavaScript também passaram nessa execução. |
| Regressão do laboratório | **65 testes aprovados**. [Execução 43552184042](https://github.com/helderfilgueira/onix-35-viva-capim/actions/runs/43552184042). |
| Mapa integrado ao Django | Verificação de navegador local aprovada: rota entre pisos, seleção de piso, bloqueio de acesso sem degraus não comprovado, elevador a partir da porta explícita e abertura da nova avaliação da loja. Não comprova funcionamento no endereço Vercel. |

Os resultados CI acima foram conferidos pelos estados e logs do GitHub Actions. A evidência de navegador foi produzida na demonstração local; não é inspeção física do shopping.

## Supabase remoto

O projeto gratuito `onix35-viva-capim`, em São Paulo, está criado. Conexão, migrações e seed remoto de demonstração foram concluídos pela integração. Verificação do catálogo PostgreSQL encontrou **22 tabelas**, todas de propriedade do papel `onix_django`, com RLS habilitada e privilégio `SELECT` falso para `anon` e `authenticated`. Não foram versionadas credenciais, senhas, banco ou conexão.

A verificação Security Advisors retornou somente informação `rls_enabled_no_policy`, sem achados WARNING/ERROR. A ausência de políticas permissivas é intencional: o banco do piloto é acessado pelo backend Django, sem leitura direta do cliente pela Data API. Isso não significa que RLS substitua autorização dentro do Django, nem constitui certificação de segurança. Referência: [Supabase Advisor 0008](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## O que ainda não está comprovado

- Publicação Vercel e jornada no endereço publicado; não há URL de produção declarada pronta neste relatório.
- Primeiro disparo real de retenção agendada e monitoramento operacional do cron.
- Backup/restauração testados e canal/controlador real para atendimento de direitos.
- Revisão humana/aprovação do PR, teste com participantes e validação presencial da acessibilidade do shopping.

Continuar com dados fictícios. O piloto sem OTP não comprova posse do telefone. Pontuação é igual para qualquer nota, resgate é assistido e nenhuma avaliação antiga gera crédito retroativo.
