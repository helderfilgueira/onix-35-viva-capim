# Equipe, responsabilidades e fluxo

## Responsáveis humanos

| Área | Responsável |
|---|---|
| Produto, frontend e liderança | Helder Filgueira |
| Backend e regras de dados | Gabriel Schimit |
| Qualidade e critérios verificáveis | Luis |
| Integração e operação | Robson |

Não associar nomes a handles GitHub sem confirmação. CODEOWNERS contém somente a conta proprietária já identificada; não concede acesso nem ativa proteção de branch.

## Equipe de agentes

| Papel especialista | Entrega e limite |
|---|---|
| PO | Requisitos, prioridade, critérios e issues; não declara aceite sem evidência |
| Scrum Master | Dependências, fluxo, bloqueios e integração; não cria sprint concluída por avanço textual |
| Design UX/UI | Hierarquia simples por persona, estados e acessibilidade; não confunde animação com usabilidade |
| Arquiteto de software | ADR, fronteiras, autorização e contratos; preserva autoridade da planta |
| Backend | Modelos, migrações, escopo de organização, pontos e transações |
| Frontend | Telas, pt/en/es, teclado/toque e feedback real |
| Full stack | Jornada entre telas, contratos e backend; não duplica regras de saldo no cliente |
| QA | Testes de acesso cruzado, privacidade, concorrência, interface e regressão; relatório real |
| DevOps | CI, configuração, deploy no provedor confirmado e recuperação; sem publicação fictícia |
| Pesquisador | Fontes primárias, referências e limites; recomendação não vira evidência de implementação |
| Especialista 3D | Preservação de mapa, seleção e percursos; alterações sustentadas pela planta |

Definições reutilizáveis dos papéis PO e Scrum Master ficam em `.claude/agents/` e operam somente em leitura: propõem correções e operações no GitHub, aplicadas apenas após aprovação humana. Agentes podem acumular papéis em um ciclo, com propriedade de arquivos explícita. A lista define responsabilidades, não afirma que todos estão executando simultaneamente. Uso de Claude deve ser exclusivamente Opus 5.5.

## Fluxo e pronto

Backlog → Pronto → Em andamento → Revisão → QA → Concluído. Limitar cada executor a uma tarefa principal; dependências bloqueadas ficam identificadas, sem marcar Done para liberar o quadro. Cada issue referencia PR, commit, testes e limitações. Revisão humana é distinta da assistência de IA.

Pronto para execução: persona, resultado, aceite, dependências e dono definidos. Concluído: fluxo integrado, testes pertinentes aprovados, migrações/documentação revisadas e evidência reproduzível. Emissão de pontos/resgate exige testes negativos e concorrência no banco alvo.

## Quatro marcos

1. **Acesso e governança:** contas, escopos e documentação.
2. **Conteúdo e experiência:** eventos/benefícios aprovados, anúncios, campanhas e três idiomas.
3. **Fidelidade e resgate:** cadastro pendente, carteira global e balcão.
4. **QA e publicação controlada:** regressão, operação e deploy comprovado no provedor confirmado.

Issues do piloto são diferentes das issues #1–#8, que registram o laboratório anterior. A lista e os links estão em [ISSUES_PILOTO.json](ISSUES_PILOTO.json). Nenhum milestone foi encerrado automaticamente.

GitHub Projects não foi configurado: o token disponível não tem `read:project`. Não foi solicitado refresh de credenciais. Os quatro milestones e as issues organizam o trabalho enquanto o quadro não estiver disponível. Esse bloqueio não significa que o restante do repositório esteja bloqueado.

## Incremento: mapa PT/EN/ES

Prioridade: traduzir o conteúdo visível do mapa e as informações das lojas sem alterar a planta. Pesquisador mantém o catálogo local `laboratorio/static/map-content-i18n.json`; UX/Frontend integra interface e estados; Backend cobre instruções de percurso; QA confere cobertura, marcas e preservação da rota; DevOps publica somente após evidências.

Critérios de aceite:

- Interface, categorias, pisos, instalações, descrições, horários e fontes em PT/EN/ES; nomes comerciais e códigos preservados.
- Nenhuma tradução automática externa em tempo de uso. Avisos de acesso não confirmado, geometrias inferidas e horários desconhecidos mantêm o mesmo sentido.
- Trocar idioma mantém origem, destino, loja selecionada, preferência acessível e percurso ativo; não recalibra coordenadas nem inventa conexões.
- VLibras continua PT→Libras, com opt-in e isolamento das páginas com dados pessoais; em EN/ES o widget é ocultado sem perder a rota.
- Cobertura do catálogo e QA de interface/percurso são evidências distintas. Catálogo validado não comprova publicação nem revisão por tradutor humano.

Baseline do conteúdo em 14/11/2026: 1.058 textos únicos por idioma, 1.674 ocorrências no payload de navegação e 138 nomes comerciais preservados. Tradução assistida por Claude Opus 5.5, seguida de validação independente de chaves e amostragem de avisos técnicos. A referência de cobertura está em `docs/QA_MAPA_CONTEUDO_I18N.json`; novos conteúdos exigem atualizar catálogo e cobertura.

## Revisão PO/Scrum Master · 14/11/2026

Aplicadas após aprovação do usuário: correção de SHAs e contagens desatualizados nas evidências, runbook com mapa PT/EN/ES, labels de área/estado, milestone do laboratório, comentários de rastreio nas issues e atualização do PR #18. Nenhuma issue ou milestone foi encerrado.

Decisões humanas pendentes:

- **PR #19** (backend FastAPI em `backend/`) concorre com a arquitetura Django + Vercel + Supabase do piloto e não tem CI: absorver, adaptar ou arquivar.
- **Limite diário e janela da loja:** avaliação gravada sem pontos por limite diário ainda bloqueia nova concessão na mesma loja por 30 dias (evento: permanentemente). Opções: considerar só avaliações premiadas ou documentar o comportamento atual.
- **Dados de QA na média pública:** avaliações de teste completaram a amostra mínima da Vivara. Opções: aguardar a retenção, remoção auditada ou usar alvo fictício excluído do agregado nos próximos ciclos.

## Incremento: experiência interativa (branch `feat/experiencia-interativa`)

Escopo, contratos, divisão de responsabilidades e mudança de regra em `MISSAO_EXPERIENCIA.md`. Estado honesto:

| Item | Estado |
|---|---|
| Mascotes pixel art no mapa (RF01–RF03) | Implementado e testado localmente (Playwright, WebGL por software) |
| Tela "Toque para iniciar" e modo totem (RF04–RF05) | Implementado e testado localmente |
| Cartões, painel, upload e local do catálogo (RF06–RF08) | Implementado; backend com testes Django em SQLite e PostgreSQL 16 |
| Rota a partir do cartão (RF09) | Implementado e testado localmente |
| Página do evento, Google Agenda, `.ics` e QR (RF10) | Implementado; link do Google sem documentação oficial pública |
| Campanha assistida no balcão (RF11) | Implementado; concorrência validada em PostgreSQL 16 |
| Publicação | **Não publicado** |
| Teste em hardware real de totem | **Não realizado** (sem equipamento) |

Decisões humanas novas: licença dos assets (o repositório não declara licença; os mascotes são originais e gerados por código), e confirmação da regra de 5 pontos por campanha pela equipe.

Fluxo sem GitHub Projects: labels `estado:pronto`, `estado:em-andamento`, `estado:revisao` e `estado:qa` funcionam como colunas; backlog é a ausência de estado e concluído é a issue fechada, sempre com evidência.
