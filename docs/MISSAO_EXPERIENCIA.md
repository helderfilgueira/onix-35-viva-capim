# Missão: experiência interativa, personagens, campanhas e agenda

Status: **em implementação** na branch `feat/experiencia-interativa`, criada a partir de `feat/totem-mapa-primeiro`. Este documento registra a auditoria (Etapa 0), os contratos (Etapa 1) e as decisões tomadas. Nada aqui está publicado até constar em `EVIDENCIAS_PILOTO.md` com verificação real.

Agentes de IA auxiliam a equipe humana — Helder (frontend/liderança), Gabriel (backend), Luis (QA) e Robson (integração/operação) — e não registram aprovação em nome dela. Modelo usado: Claude Opus 5.5.

## 1. Auditoria (Etapa 0, 14/11/2026)

### Linha de base
| Item | Resultado |
|---|---|
| Branch base | `feat/totem-mapa-primeiro`: modo totem, controles 3D, distâncias e QR ainda sem commit, preservados |
| Testes do laboratório | 69/69 OK |
| Testes do piloto (SQLite) | 56 executados, OK; 6 pulados porque exigem PostgreSQL |
| Ferramentas locais | Docker 29 disponível, para rodar os testes PostgreSQL; Pillow presente só no venv local, fora de `requirements.txt` |
| PRs abertos | #9 e #18 (draft) e #19 (backend v1, de outro autor); não foram alterados |

### O que já existe e será reutilizado
- **`Event`** (`pilot/core/models.py`): título, descrição, traduções EN/ES, status `pending/approved/paused`, `starts/ends` e `location` em texto livre.
- **`Content` com `kind='ad'`**: banner já com imagem (data URL validada por assinatura binária, até 300 KB, guardada no PostgreSQL), alt nos três idiomas, `starts/ends` como janela de exibição e aprovação editorial que exige EN/ES. Vira o **cartão de anúncio**.
- **Ledger, `redeem()` e balcão (`#/counter`)**: travam o membro com `select_for_update`, usam chave idempotente e registram auditoria. A recompensa de campanha segue esse mesmo padrão.
- **Mapa**: o motor `createPlanScene` tem rótulos em sprites billboard, `hitObjects` para clique, `dispose` e `setReducedMotion`. O grafo de corredores tem 2 componentes (f0 com 250 nós, f1 com 46) e nenhuma aresta de corredor atravessa polígono de loja; isso foi verificado por amostragem a cada 0,25 m.
- **QR**: `laboratorio/static/vendor/qrcode.js`, local, compatível com a CSP `script-src 'self'`.

### Restrições encontradas
- `Ledger.target_type` tem `max_length=5`. Um valor maior passa no SQLite e quebra no PostgreSQL, então exige migração.
- O teto diário de 30 pontos já soma apenas `kind='review'`. Um tipo novo de lançamento fica naturalmente fora dele.
- Toda tabela nova precisa de migração chamando `protect_public_tables` (RLS do Supabase). **Decisão:** esta missão só adiciona colunas, nenhuma tabela.
- `legacy_file` (pilot) e `server.py` (laboratório) usam lista fixa de arquivos. Cada asset novo do mapa precisa ser incluído nas duas.
- `reset()` do mapa apaga `?modo=totem` da URL. A persistência do modo totem precisa ser explícita.
- A CSP global envia `no-store`. O `.ics` precisa de `Content-Type: text/calendar`.
- **Imagem de referência dos cartões sobrepostos: não encontrada** no repositório nem nas pastas do projeto. O candidato mais próximo é `outputs/primeira_entrega_v2/PROPOSTA_VISUAL_2026.png`, com um único cartão inclinado. A composição implementada é **original, feita a partir da descrição**. Nenhuma imagem ausente foi "analisada".

## 2. Mudança de regra de produto (registrada)

Até aqui, pontos vinham **somente de avaliações**, e a documentação dizia que "campanha não dá pontos". O responsável pediu uma recompensa ligada a anúncios e eventos. As regras de avaliação **não mudam**.

| Regra | Avaliação (inalterada) | Campanha de interesse (nova) |
|---|---|---|
| Valor | 10 pts por qualquer nota | 5 pts, fixados no servidor |
| Frequência | 1 vez por loja a cada 30 dias; 1 vez por evento | 1 vez por membro e campanha, para sempre (o estorno não reabre) |
| Teto diário | 30 pts/dia, só de avaliações | 5 pts/dia, só de campanhas e separado do anterior |
| Quem dispara | o próprio visitante, informando o telefone | **somente** um operador autorizado no balcão, com o membro presente |
| Padrão | — | desativada; o administrador habilita por cartão |
| Elegibilidade | membro ativo | membro ativo; cartão aprovado, dentro da vigência e de organização ativa; operação não pausada |

- **Não pontuam:** abrir o banner, gerar o QR, abrir a agenda, adicionar o evento à agenda e o easter egg "Encontre o trio".
- **Texto exibido ao público:** "Confirme seu interesse nesta campanha para receber 5 pontos, conforme as regras." O totem orienta a pessoa a procurar o balcão e **não pede telefone**.
- **Identidade:** a confirmação no balcão **não é verificação de posse do telefone**, porque o piloto não tem OTP. O risco de alguém se passar por outra pessoa continua o mesmo de `PRIVACIDADE.md`. Uma automação futura depende de autenticação de membro, que não deve ser improvisada.
- **Privacidade:** o lançamento serve só ao crédito de fidelidade, sem marketing e sem segmentação. A retenção é a mesma do ledger.
- **Estorno:** só o administrador estorna, com motivo, e só uma vez por crédito. O saldo precisa cobrir os 5 pontos; pontos já gastos não são estornados, e o caso vai para análise manual.

## 3. Contratos

### Dados (migração `0004`, reversível, só adiciona colunas)
- **`Event.store_id`**: destino do catálogo do mapa, validado no servidor. Coordenadas livres não são aceitas.
- **`Event.all_day`**: indica evento de dia inteiro.
- **`Content.event`**: chave estrangeira para `Event`, opcional, com `SET_NULL`.
- **`Content.store_id`**: local do cartão quando ele não tem evento.
- **`Content.position`**: ordem de exibição.
- **`Content.reward_enabled`**: falso por padrão.
- **`Ledger.kind`**: ganha o valor `campaign`.
- **`Ledger.target_type`**: passa a aceitar até 16 caracteres.
- **Restrição única** sobre `(member, target_id)` quando `kind='campaign'`.
- **Restrição única de estorno**: um estorno por crédito de campanha.

### API (dispatcher único `api/v2/`)
- `GET public/cards`: cartões vigentes ordenados por `position`, com textos já no idioma pedido, `image_url`, evento, local, piso, `route_available` e `reward_points` (presente só se a recompensa estiver habilitada).
- `GET public/cards/<id>/image`: entrega os bytes da imagem validada. Os cartões não embutem base64.
- `GET public/events/<id>`: dados públicos do evento.
- `POST counter/campaign-credit {member_id, content_id}`: só staff, com escopo por organização, idempotente. Responde 201 quando creditou e 200 quando o crédito já existia.
- `POST campaign-credits/<ledger_id>/reverse {reason}`: só administrador.

### Página pública do evento
- `/evento/<id>/`: HTML gerado no servidor que abre no celular sem depender de JavaScript. Mostra título, data, horário em `America/Araguaina`, local e piso, e traz o link do Google Agenda e o arquivo `.ics`.
- `/evento/<id>.ics`: `text/calendar`, RFC 5545. Evento com horário usa UTC; evento de dia inteiro usa `VALUE=DATE`.
- O QR do totem aponta só para a URL canônica `/evento/<id>/`, sem nome, telefone, sessão ou token.
- Evento cancelado (pausado) ou encerrado mostra esse estado na página e não oferece adicionar à agenda.

### Mapa e totem (`laboratorio/static`)
- **`map-mascots.js`**: desenho procedural em pixel art e passeio pelo grafo de corredores, sem trocar de piso. O motor carrega esse módulo pela opção `createPlanScene(..., {mascots, onMascot})`. Os personagens não entram em `hitObjects`; usam um raycast próprio, chamado só quando o clique não acertou uma loja.
- **`kiosk.js` + `kiosk.css`**: tela "Toque para iniciar". O modo totem fica persistido em `localStorage['viva-kiosk']`: `?modo=totem` liga e `?modo=site` desliga. Links com `destination` ou `origin` pulam a tela inicial. O reset do totem volta para ela.
- **`cards.js` + `cards.css`**: pilha de cartões e diálogo de detalhe. Se a API falhar, o módulo se esconde sem afetar o mapa.
- **Easter egg**: o progresso fica só na memória do atendimento e é apagado por `viva:map-reset`. Não dá pontos. Há uma alternativa acessível em lista.

## 4. Divisão de responsabilidades (quem edita o quê)

O ambiente oferece subagentes, mas **as edições são sequenciais**: um arquivo tem um único editor por vez. Os papéis de especialista que revisam e testam rodam como agentes independentes.

| Papel | Arquivos | Executor |
|---|---|---|
| Líder técnico / integrador | este documento e a integração final | agente líder |
| Backend | `pilot/core/{models,services,views}.py`, migração `0004`, testes | agente líder, com revisão de um agente backend independente |
| Frontend / UX / motion | `laboratorio/static/{kiosk,cards}.{js,css}`, `explorar.*`, `map-i18n.js` | agente líder |
| Pixel art / Three.js | `laboratorio/static/map-mascots.js`, `map-plan3d.js` | agente líder |
| Painel administrativo | `pilot/static/dashboard/dashboard.js`, `i18n.js` | agente líder |
| QA independente | apenas leitura, scripts em `scratchpad` | agentes QA sem acesso de escrita ao código |
| PO / Scrum Master | backlog e documentação | agentes `po` e `scrum-master`, apenas leitura e propostas |
| DevOps | publicação | só com autorização vigente; nenhum merge na `main` |

## 5. Critérios de aceite (resumo; os bloqueantes estão no prompt da missão, seção 10)
- RF01 a RF15 e RNF01 a RNF10, verificados por testes Django (SQLite e **PostgreSQL 16 via Docker** para concorrência), testes do laboratório e Playwright.
- Nenhum teste em hardware real de totem será declarado sem o equipamento.
- Medição de desempenho antes e depois, registrando o ambiente (WebGL por software no Playwright).

## 6. Rollback

Do mais leve ao mais pesado:

1. **Desligar a campanha sem deploy:** desmarcar "Habilitar campanha de pontos" no cartão (volta a pendente) ou pausá-lo. Para congelar toda a fidelidade, usar `PILOT_OPERATIONS_ENABLED=false` (créditos e resgates passam a responder 503).
2. **Tirar o totem do modo atração:** abrir `/explorar.html?modo=site` no aparelho. Isso apaga a marca `viva-kiosk` só daquele aparelho.
3. **Voltar o frontend:** promover na Vercel o deployment anterior. Os arquivos novos (`kiosk.*`, `cards.*`, `trio.*`, `map-mascots.js`) ficam inertes sem o `explorar.js` novo.
4. **Voltar o banco:** só depois de exportar os lançamentos `campaign`, rodar `python manage.py migrate core 0003`. A migração 0004 só adiciona colunas e restrições, então o retorno remove `store_id`, `all_day`, `event`, `position` e `reward_enabled`, além das restrições de campanha.
   - **Cuidado:** lançamentos `kind='campaign'` continuam no ledger e o saldo não muda. Decida antes se vão ser estornados (`POST /campaign-credits/<id>/reverse`) ou mantidos.
   - Pedir confirmação humana antes de qualquer passo no banco de produção.

## 7. Limitações conhecidas
- **Link "Adicionar ao Google Agenda":** segue um formato documentado por terceiros, sem documentação oficial pública. Pode mudar sem aviso; o `.ics` é a alternativa.
- **Mascotes:** usam corredores do grafo inferido da planta. Não representam pessoas, lotação nem rastreamento.
- **Testes:** o desempenho e o visual foram verificados no Playwright com WebGL por software, não em hardware de totem.
- **Imagem de referência dos cartões:** não estava nos arquivos; a composição é original.
- **Licença dos mascotes:** sem licença declarada no repositório; decisão humana pendente.
