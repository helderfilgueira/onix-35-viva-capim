# Privacidade e risco do piloto

Este é um registro de projeto, não parecer jurídico ou certificação LGPD. A mudança para fidelidade identificada é nova finalidade; o aviso do laboratório sem nome/telefone não cobre automaticamente o piloto.

| Dados | Finalidade e acesso |
|---|---|
| Nome, sobrenome, telefone, declaração 18+, aceite | Adesão à fidelidade e atendimento; cadastro pendente até ativação administrativa |
| Avaliação e aspecto | Medição da experiência; parceiro vê somente agregado com amostra mínima |
| Crédito, débito, benefício e comprovante | Integridade da carteira e resgate assistido; acesso restrito ao escopo operacional |
| Preferências de interface | Adaptar apresentação; não coletar diagnóstico ou identificar deficiência |
| Registros de operadores | Autorização e auditoria administrativa; não registrar senhas/tokens |

## Regras adotadas

Mapa e agenda continuam sem cadastro. Fidelidade é opcional e não exige nota positiva. Consentimento não deve vir marcado; marketing não faz parte desse aceite. Um cadastro não deve criar acesso público a saldo por número de telefone.

As avaliações têm retenção de 30 dias. A carteira e os lançamentos são separados: não apagar histórico financeiro automaticamente ao remover uma avaliação e não conservar a nota individual só para justificar saldo. Política operacional definida para este piloto: cadastros pendentes sem ativação são eliminados após 30 dias; lançamentos permanecem enquanto a carteira estiver ativa para integridade de saldo e prevenção de crédito repetido. Após encerramento, nome e telefone são removidos e o histórico fica pseudonimizado, com acesso restrito de auditoria, por 180 dias; depois é eliminado pela rotina de retenção. Esses 180 dias contam do encerramento, não da data de cada lançamento. A operação precisa agendar e verificar a execução da rotina; ter um comando não comprova expurgo automático.

Resultados agregados com mínimo de cinco avaliações não são garantia absoluta de anonimização. Não incluir nomes, telefones, sessões, recibos, horário exato ou filtros de grupos pequenos no painel do parceiro. Nunca apresentar histórico de notas junto ao cadastro do membro.

## Missão experiência (cartões, agenda, campanha e totem)

- **Campanha de interesse:** o lançamento `campaign` no extrato registra membro, campanha, valor, operador e data, com a única finalidade de crédito de fidelidade; não é marketing nem segmentação, e segue a mesma retenção do extrato. O totem não pede telefone para campanhas: a confirmação é presencial no balcão.
- **QR e agenda:** o QR leva apenas à página pública do evento (`/evento/<id>/`), sem nome, telefone, saldo, sessão ou token. O visitante adiciona o evento na própria agenda; abrir o link não comprova inclusão e nada é registrado sobre isso. O totem nunca autentica conta Google.
- **Imagens de banner:** EXIF/XMP/IPTC e comentários são removidos no servidor antes de gravar.
- **Modo totem:** a marca `viva-kiosk` em `localStorage` é configuração do aparelho, não dado de visitante. O progresso do easter egg fica só na memória do atendimento e é apagado no encerramento.

## Risco explicitamente aceito para desenho do piloto

Não há OTP. Nome e telefone digitados não comprovam identidade ou posse do número; ativação administrativa também não comprova isso. Há risco de cadastro indevido, atribuição de pontos e solicitação de benefício por terceiro. O resgate fica restrito ao balcão autenticado, com procedimento assistido; essa restrição reduz exposição, não elimina o risco. Não anunciar cadastro como “telefone verificado”.

Encerramento não obriga gastar saldo: o atendimento pode registrar renúncia expressa do titular, com motivo e lançamento auditável, antes de remover os dados de cadastro. A renúncia não pode ser presumida ou pré-marcada pelo operador.

Pedidos de acesso, correção ou exclusão exigem atendimento assistido e evidência proporcional ao pedido; telefone sozinho não é prova suficiente. Evitar coleta indiscriminada de documentos. Controlador, canal responsável e procedimento devem estar publicados antes do piloto real. Esses contatos reais ainda não foram confirmados: são bloqueio de liberação para coleta real, mantendo a demonstração com dados fictícios.

Por decisão do usuário, o aviso e encerramento automático por inatividade existem somente no mapa `/explorar.html`. Catálogo `/participar/`, cadastro e avaliação não abrem aviso, não navegam nem limpam campos automaticamente por tempo ocioso; o botão manual “Encerrar atendimento” permanece para limpar a interface ao terminar. Ao usar essas páginas em totem compartilhado, encerrar manualmente antes de passar ao próximo visitante. A expiração de sessão administrativa no servidor continua independente dessa regra. Não deixar senha administrativa ou telefone em preenchimento automático. VLibras é opt-in somente no catálogo público e no mapa `/explorar.html`; a política CSP admite os domínios necessários apenas nesses documentos. Cadastro, avaliação e painéis privados continuam sem o recurso e sem autorização de CSP para seus terceiros. Novo atendimento no mapa recarrega uma URL limpa quando VLibras estiver carregando ou carregado, descarregando o JavaScript de terceiros; o próximo visitante precisa de novo opt-in. Sem plugin iniciado, o mapa mantém seu reset habitual. O aviso de inatividade conserva o foco no próprio diálogo ao fechar o consentimento de Libras.

Fundamentação e limitações das fontes: [pesquisa](PESQUISA.md). Não publicar dados de visitantes em issues, capturas de teste ou backups versionados.
