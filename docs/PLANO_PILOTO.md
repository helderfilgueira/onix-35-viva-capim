# Escopo fechado do piloto administrativo

Baseline de execução: 14/11/2026. Este documento registra decisões de produto, não resultados de testes nem confirmação de hospedagem.

## Público e permissões

- **Administrador:** administra parceiros, operadores, conteúdo, ativação de membros, benefícios e visão global da fidelidade; aprova eventos e benefícios antes da publicação.
- **Parceiro:** gerencia apenas seus negócios/eventos e benefícios, consulta avaliações agregadas do próprio escopo. Não lista membros de outras organizações nem altera saldo arbitrariamente.
- **Operador de balcão:** busca telefone em ambiente autenticado e realiza resgate assistido apenas no escopo autorizado. Não é superadministrador.
- **Visitante:** mapa e agenda públicos. Pode enviar cadastro de fidelidade; não existe login de membro, consulta pública de saldo nem resgate público neste piloto.
- **Acessibilidade:** preferências do mesmo visitante, não um papel separado e não um cadastro de deficiência.

## Fidelidade e avaliações

Carteira única do shopping. Dez pontos por avaliação elegível, igualmente para notas de 1 a 5; uma concessão por loja a cada 30 dias, uma por evento e limite de 30 pontos de avaliação por membro/dia. **Campanha de interesse (regra adicionada em 14/11/2026):** cartão de anúncio pode habilitar 5 pontos por membro, uma única vez por campanha, máximo de 5 pontos de campanha por membro/dia (limite separado do de avaliações), creditados somente por operador autorizado no balcão, com o membro presente, durante a vigência do cartão aprovado; desativada por padrão. Abrir banner, gerar QR ou adicionar à agenda não pontua. A confirmação assistida não verifica posse do telefone. Detalhes em `MISSAO_EXPERIENCIA.md`. Sem expiração de pontos durante o piloto. Não importar créditos de avaliações antigas.

Cadastro no site, totem ou balcão: nome, sobrenome, telefone, declaração de maioridade (18+) e aceite específico. O cadastro fica pendente até ativação administrativa. A ativação não verifica posse do número. Não há OTP: registrar risco de personificação e nunca apresentar telefone como prova de identidade. Não oferecer saldo por consulta pública ao número.

Resgates são assistidos por operador autenticado; benefício precisa estar aprovado, disponível e no escopo do operador. Crédito, débito, estoque e comprovante devem formar uma operação íntegra, sem consumo duplicado em repetição/concorrência. A razão de uma avaliação nunca altera sua pontuação.

Avaliações permanecem agregadas no painel do parceiro; limiar mínimo de cinco registros, sem nome, telefone ou identificador individual. Lançamentos de fidelidade têm finalidade e retenção separadas da avaliação: preservados durante carteira ativa e por 180 dias após encerramento com cadastro desidentificado e acesso de auditoria; depois expurgados. Cadastros pendentes sem ativação expiram em 30 dias. Contatos reais do controlador/canal de direitos ainda não confirmados bloqueiam liberação para dados reais.

## Conteúdo e experiência

Anúncios: cartões com banner (PNG/JPEG/WebP até 300 KB, metadados removidos no servidor), texto alternativo, título e descrição em PT/EN/ES, evento vinculado opcional, local do catálogo do mapa, ordem e vigência de exibição distinta das datas do evento; sem venda de mídia, cobrança ou segmentação pessoal. Eventos têm página pública `/evento/<id>/` com Google Agenda e arquivo `.ics`; o QR do totem aponta só para essa página. Eventos, cartões e benefícios passam por aprovação do administrador.

Campanhas de Natal, Ano Novo, Páscoa e Dia dos Pais usam tema e três descobertas digitais. Esses easter eggs não geram pontos. No mapa, o easter egg "Encontre o trio" (três mascotes fictícios em pixel art) guarda progresso só no atendimento atual, é limpo no encerramento e não gera pontos. A missão deve ter alternativa em lista acessível; o mapa 3D não pode ser requisito obrigatório.

Modo totem explícito por aparelho (`/explorar.html?modo=totem` liga; `?modo=site` desliga), com tela "Toque para iniciar" que não aparece para visitantes do site comum nem bloqueia links diretos; no totem, o encerramento do atendimento volta a essa tela. Inatividade automática limitada ao mapa `/explorar.html`. Catálogo, cadastro e avaliação mantêm encerramento manual, sem limpeza automática por tempo ocioso; expiração administrativa no servidor permanece.

Catálogo, cadastro e avaliação públicos oferecem botões PT/EN/ES. A evolução do mapa também exige PT/EN/ES, incluindo interface, orientações, categorias, pisos, serviços e informações descritivas das lojas. Nomes comerciais, códigos, coordenadas e posições da planta permanecem intactos. A tradução usa catálogos locais, sem API externa de tradução durante o uso; a troca de idioma deve preservar seleção, origem, destino e percurso ativo. O dashboard mantém seu seletor anterior. Preferências de texto, contraste e movimento reduzido permanecem. VLibras é opt-in no catálogo público e no mapa, com modal antes de carregar o serviço externo; não é carregado em cadastro, avaliação ou painéis privados. VLibras destina-se ao conteúdo em português; não traduz inglês ou espanhol para Libras. A integração não equivale a tradução humana validada.

## Piloto controlado

Duração: 30 dias. Limites: 100 membros e cinco parceiros. Hospedagem escolhida pelo usuário: Vercel para Django e Supabase para PostgreSQL. Docker permanece alternativa portável, sem substituir automaticamente a escolha. Nenhuma contratação paga automática. Disponibilidade, suspensão por inatividade, armazenamento e limites devem ser conferidos no provisionamento. Só publicar quando credenciais, configurações, testes e responsável de operação estiverem disponíveis. Nenhum endereço de produção é declarado por antecipação.

Estado externo: o usuário autorizou explicitamente a liberação de uma vaga por pausa de outro projeto. O projeto Supabase `onix35-viva-capim` foi criado no plano gratuito, em São Paulo, e retornou estado `ACTIVE_HEALTHY`. Conexão, migrações e seed remoto foram concluídos; 22 tabelas com RLS e sem privilégio de leitura direta para anon/authenticated foram verificadas. Demonstração Vercel publicada e jornadas públicas/dashboard verificadas após correção de assets. Revisão humana do PR #18 e liberação para dados reais continuam pendentes. Resultados de CI e limites estão em [evidências](EVIDENCIAS_PILOTO.md). O nome e os dados do outro projeto não fazem parte deste repositório. Consulte [deploy escolhido](DEPLOY_SUPABASE_VERCEL.md).
