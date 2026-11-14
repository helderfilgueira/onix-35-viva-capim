# Viva Capim · Equipe Onix - 35

Navegação no shopping, eventos, avaliações e fidelidade. Este repositório contém três etapas diferentes do projeto; a existência de código não comprova implantação no shopping ou liberação para dados reais.

| Área | Finalidade | Estado |
|---|---|---|
| [`missao-1/`](missao-1/) | Planejamento original do HackaRun, diagramas e RACI | Entrega documental preservada; não equivale ao produto atual |
| [`laboratorio/`](laboratorio/README_LAB.txt) | Demonstração local do mapa 3D/2D e avaliações | Fonte do catálogo, geometria, logomarcas e rotas existentes; limites em [Pisos e estrelas](laboratorio/docs/PISOS_E_ESTRELAS.txt) |
| `pilot/` | Novo backend Django e portais administrativos | Implementação do piloto; aprovação operacional depende dos testes e do [runbook](docs/RUNBOOK.md) |

## Começar

- Para o mapa local, execute `laboratorio/ABRIR_LABORATORIO.cmd` com Python instalado.
- Para o piloto, siga [execução e operação](docs/RUNBOOK.md). O desenvolvimento usa `python pilot/manage.py runserver 127.0.0.1:8879` após preparar dependências e banco.
- [Decisão e arquitetura](docs/ARQUITETURA.md) · [Escopo fechado](docs/PLANO_PILOTO.md) · [Privacidade](docs/PRIVACIDADE.md) · [Backlog e equipe](docs/EQUIPE_E_BACKLOG.md) · [Fontes](docs/PESQUISA.md).
- [Primeira entrega em PDF](missao-1/ONIX_35_VIVA_CAPIM_MISSAO_1.pdf) e [diagramas históricos](missao-1/Kit_Jira_Confluence/Diagramas/INDICE.txt).

## Hospedagem escolhida

Vercel + Supabase PostgreSQL, mantendo Django. O projeto Supabase `onix35-viva-capim` foi criado no plano gratuito, na região São Paulo, após liberação de vaga explicitamente autorizada pelo usuário. Migrações e seed remoto concluídos; 22 tabelas verificadas com RLS e leitura direta negada a anon/authenticated. CI: 56 testes PostgreSQL e 69 de regressão aprovados no commit de aplicação `be2a340`. Demonstração publicada e verificada na nuvem: [site](https://onix35-viva-capim.vercel.app/participar/), [dashboard](https://onix35-viva-capim.vercel.app/dashboard/) e [mapa](https://onix35-viva-capim.vercel.app/explorar.html). PR #18 permanece Draft, com revisão pendente; consulte as [evidências](docs/EVIDENCIAS_PILOTO.md). Veja [estado e roteiro de deploy](docs/DEPLOY_SUPABASE_VERCEL.md). Docker permanece opção portável.

## Equipe humana

| Integrante | Responsabilidade |
|---|---|
| Helder Filgueira | Frontend e liderança |
| Gabriel Schimit | Backend |
| Luis | QA |
| Robson | Integração e operação |

Assistência de agentes é declarada na documentação. Os agentes não substituem os responsáveis humanos nem representam contas de colaboradores adicionadas ao GitHub.

## Limites que importam

A rota acessível não cria aproximação ao elevador sem evidência na planta. Fachadas e interiores 3D são ilustrativos. O piloto de fidelidade concede os mesmos pontos para qualquer nota; telefone sozinho não comprova identidade. A opção escolhida sem OTP tem risco residual explícito e resgate somente assistido no balcão. Não há promessa de conformidade LGPD, acessibilidade certificada, SMS enviado, pontos retroativos ou disponibilidade contínua de hospedagem gratuita.

Contribua por pull request seguindo [CONTRIBUTING.md](CONTRIBUTING.md). Não publique bancos, telefones de visitantes, senhas, tokens, planta técnica bruta ou comprovantes pessoais.
