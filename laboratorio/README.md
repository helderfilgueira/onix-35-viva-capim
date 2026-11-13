> **Versão atual — revisão das três páginas:** 211 unidades, 208 contornos, 196 destinos com percurso inferido. Leia [revisão integral](docs/REVISAO_INTEGRAL.txt) e abra `ABRIR_LABORATORIO.cmd`. Há três contornos e 15 acessos pendentes; o mapa não é levantamento certificado.

# Viva Capim

> **Laboratório 3D:** a evolução atual está documentada em [README_LAB.txt](README_LAB.txt) e [resultado do ciclo](docs/RESULTADO_CICLO_1.txt). Use `ABRIR_LABORATORIO.cmd` para abrir o explorador. O texto abaixo registra a baseline original; as limitações antigas sobre ausência de QR/mapa 3D foram superadas no explorador, enquanto produção e totem público continuam pendentes.

Demonstração executável local para o desafio de eventos, entretenimento e experiências do Hackarun 2026. A prática escolhida é LGPD. Nome provisório. Todo evento e o mapa são fictícios. Não é serviço oficial do Capim Dourado Shopping e não há submissão ao evento neste pacote.

## Executar

Requisito: Python 3.10 ou superior. Não há pacotes externos, instalação npm, conta em nuvem ou chave de API.

1. Extraia o pacote em uma pasta.
2. No Windows, abra `start.cmd`, ou execute `py server.py` no terminal dessa pasta. Em outros sistemas, use `python3 server.py`.
3. Acesse http://127.0.0.1:8765.
4. Para a aba Gestão, copie a credencial administrativa que o servidor exibe no terminal. Ela é gerada novamente em cada execução. Não a compartilhe.
5. Encerre com Ctrl+C no terminal.

O banco `data/demo.sqlite3` é criado no primeiro início. A agenda e os registros persistem ao reiniciar. Nenhum banco ou segredo acompanha a entrega. Opcionalmente, configure `VIVA_ADMIN_TOKEN` com ao menos 16 caracteres e `VIVA_PORT` antes de executar. O servidor aceita somente conexões de loopback.

## Roteiro de demonstração

1. Explore ou busque uma experiência sem cadastro.
2. Abra um evento e veja seu local no mapa conceitual.
3. Retorne ao evento, leia o aviso e aceite voluntariamente participar.
4. Confirme participação e envie nota de 1 a 5 com aspecto estruturado.
5. Veja o comprovante. Tente avaliar novamente: o servidor bloqueia duplicidade nessa sessão/evento.
6. Na privacidade, baixe os registros e exclua a sessão. A exclusão elimina também check-ins e avaliações.
7. Entre na Gestão com a credencial do terminal. Indicadores com menos de 5 registros aparecem suprimidos.
8. Crie um evento fictício. Tente outro no mesmo local/intervalo para demonstrar o bloqueio de conflito.

O link `/?event=musica` abre diretamente uma experiência. QR Code e NFC podem transportar esse link; o protótipo não implementa leitura de hardware nem gera QR. Como o servidor é local, um QR de loopback não abre este computador a partir de outro celular. Para demonstração no mesmo equipamento, use o link diretamente. Uma instalação real precisa de hospedagem HTTPS, domínio e revisão de segurança.

Leitura em voz usa somente uma voz local em português disponível no navegador/sistema. Sem essa voz, apresenta mensagem e mantém todo conteúdo textual. Não há envio de conteúdo a síntese externa.

## Implementado

- Agenda pesquisável, detalhes, mapa SVG esquemático e navegação responsiva.
- API e SQLite persistente para eventos, sessões, check-ins e avaliações.
- Aviso versionado e aceite estrito para participação opcional.
- Sessões aleatórias de 256 bits; apenas hash do token no banco; token no `sessionStorage`, nunca em URL.
- Nota inteira e motivo de lista fechada; campos extras rejeitados. Sem texto livre do visitante.
- Uma participação e uma avaliação por sessão/evento; isso não impede múltiplas sessões da mesma pessoa.
- Exportação e eliminação por token; eliminação em cascata e recálculo dos indicadores.
- Painel autenticado com corte fixo por evento; média, quantidade de avaliações e check-ins suprimidos abaixo de 5 registros.
- Criação de eventos com validação e bloqueio de sobreposição no mesmo local.
- Queries parametrizadas, lista restrita de arquivos estáticos, limites de corpo, validação de Host/Origin e cabeçalhos de segurança.
- Sem logs de requisição, cookies de rastreamento, bibliotecas remotas ou publicação da planta técnica.

## Contrato da API

Todas as respostas de erro usam `{ "error": "mensagem" }`. POST exige `Content-Type: application/json`. Datas de eventos são ISO 8601 com fuso. Texto de administrador é conteúdo fictício, nunca dados pessoais.

| Método e rota | Autorização | Corpo ou resposta |
|---|---|---|
| GET /api/events | Pública | Lista `events` |
| POST /api/session | Pública | `consent: true`, `notice: "demo-v1"`; retorna `token` |
| POST /api/checkins | X-Session-Token | `event_id` |
| POST /api/reviews | X-Session-Token | `event_id`, `score` inteiro 1–5, `reason` |
| GET /api/me | X-Session-Token | Exportação da sessão corrente |
| DELETE /api/me | X-Session-Token | Elimina sessão e registros dependentes |
| GET /api/admin/metrics | X-Admin-Token | Indicadores por evento com limiar 5 |
| POST /api/admin/events | X-Admin-Token | `title`, `category`, `location`, `starts`, `ends`, `description` |

Motivos: `programacao`, `localizacao`, `acessibilidade`, `organizacao`, `outro`. Locais ilustrativos: `Praça A`, `Praça B`, `Praça C`.

Status relevantes: 201 criado, 400 validação, 401 credencial/sessão inválida, 403 origem/host recusado, 404 recurso inexistente, 409 duplicidade/conflito, 413 corpo acima de 8 KiB, 415 tipo de conteúdo não permitido.

## Modelo e privacidade

Tabelas: `events`, `sessions`, `checkins`, `reviews`. Check-ins e avaliações pertencem a uma sessão e evento. Avaliação exige check-in prévio. O hash da sessão continua sendo dado pseudonimizado, não anônimo. Participação expira em 24 horas; o mesmo token ainda permite exportar/excluir até a eliminação por retenção de 30 dias, executada na próxima requisição. Fechar a aba pode perder o token. Não há backups neste protótipo.

O limiar de 5 é uma decisão demonstrativa, não uma certificação de anonimização ou regra exigida pela LGPD. Indicadores dinâmicos e comparação antes/depois ainda podem revelar diferenças. Não usar esse painel com dados reais sem análise de risco e medidas adicionais, como publicação em lotes, atraso, supressão complementar e controle de exportações. Não existem recortes por horário, perfil ou motivo na API administrativa.

## Limites e evolução

É uma demonstração funcional local, não um sistema pronto para produção. Não há autenticação corporativa com perfis, rate limit distribuído, HTTPS, auditoria completa, backup/restore, infraestrutura monitorada, confirmação de presença física, prevenção de múltiplas sessões por pessoa, promoção comercial, resgate, mapa real, 3D, totem em modo quiosque nem integração NFC. O formulário administrativo permite criar eventos; edição/cancelamento são evolução.

Antes de piloto: definir controlador/operador e canal de direitos; validar bases legais, retenção e tratamento de menores; publicar mapa autorizado; implementar autenticação individual e auditoria, HTTPS, limites de abuso, publicação protegida de métricas e rotina de expurgo agendada; executar testes de acessibilidade e de campo. A coleta de avaliação para pesquisa e eventual benefício precisam de análise própria; nenhuma nota dá direito a prêmio neste protótipo.

## Testes e assistência de IA

Execute `py -m unittest -v test_server.py test_privacy.py` (ou `python3 -m unittest -v test_server.py test_privacy.py`). A suíte usa banco em memória e portas locais temporárias, sem modificar o banco demonstrativo. Cobre consentimento, validação, isolamento, duplicidade, exportação, exclusão, retenção, limiar de indicadores, autenticação, conflito de agenda e restrições HTTP.

Este código, documentação e interface foram produzidos com assistência de agentes de IA sob coordenação do solicitante. O uso de IA deve ser declarado conforme o regulamento do evento. A equipe humana continua responsável por entender, validar e apresentar a solução. A liderança e o backend humano foram atribuídos ao solicitante no documento de equipe; agentes de IA são apoio técnico, não integrantes humanos fictícios.
