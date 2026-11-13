ATUALIZAÇÃO VISUAL: veja docs/DESIGN_MAQUETE.txt. Seleção com aproximação, fachadas e interiores ilustrativos, coberturas alternáveis e rotas preservadas.

VIVA CAPIM | LABORATÓRIO ONIX - 35

Este incremento evolui a demonstração local existente. Abra ABRIR_LABORATORIO.cmd com Python 3.10+ instalado: o explorador abre em http://127.0.0.1:8878/explorar.html. Para o estado atual, leia docs/PLANTA_RECONSTRUIDA.txt. Código 3D/2D, rotas e QR estão integrados e verificados em demonstração local.

Documentação do incremento:
- docs/LABORATORIO.txt: objetivo, inventário, processo, RACI e rastreabilidade.
- docs/ADR_001_STACK_E_MAPA.txt: decisão de preservar stack e contrato espacial.
- docs/BACKLOG.txt: prioridades e critérios de aceitação.
- docs/PESQUISA_E_PRIVACIDADE.txt: referências, dados e controles.
- docs/ARQUITETURA.svg e docs/FLUXO_VISITANTE.svg: diagramas editáveis.

Estado atual: VERIFICADO EM DEMO — 40 testes Python e 10 verificações de navegador da planta aprovados. Veja docs/E2E_RESULTADO.json e E2E_COMPLEMENTAR.txt. O reset do explorador está verificado; isolamento completo do fluxo legado de avaliação em totem público continua pendente. Não houve implantação no shopping, mapa oficial, teste com visitantes, localização contínua ou Confluence configurado.

Regra Claude: somente Opus 5.5, verificado pela ferramenta, sem fallback. Assistência de IA deve ser declarada. Equipe humana: Helder Filgueira (frontend/líder), Gabriel Schimit (backend), Luis (QA), Robson (integração/operação).
