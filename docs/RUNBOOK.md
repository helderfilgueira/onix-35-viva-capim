# Execução, verificação e operação

## Desenvolvimento local

Requisito: Python compatível com os requisitos fixados em `pilot/`. Instale as dependências de `pilot/requirements.txt` em ambiente virtual privado (`python -m pip install -r pilot/requirements.txt`). Depois, a partir da raiz do repositório:

```powershell
python pilot/manage.py migrate
python pilot/manage.py check
python pilot/manage.py test
python pilot/manage.py runserver 127.0.0.1:8879
```

Esses são comandos de operação, não uma declaração de que foram executados. A inicialização de dados/usuários deve seguir o comando e instruções reais do módulo quando presentes. Não cadastrar senhas de exemplo em um serviço publicado. A porta 8879 é do piloto; a porta do laboratório é independente.

## Antes de abrir o piloto na internet

1. Confirmar versão, migrações e requisitos efetivamente presentes; executar testes do piloto e regressão do laboratório.
2. Usar Vercel + Supabase, escolhidos pelo usuário. O Supabase `onix35-viva-capim` já foi criado no gratuito após liberação explicitamente autorizada de vaga; não há decisão de quota pendente. Conexão, migrações e seed já foram concluídos e as permissões de 22 tabelas verificadas, conforme [evidências](EVIDENCIAS_PILOTO.md). Revalidar após nova migração antes da publicação Vercel. Configurar pooler PostgreSQL somente no servidor e validar RLS/negação da Data API para tabelas privadas. Conferir [roteiro do deploy](DEPLOY_SUPABASE_VERCEL.md); não contratar plano pago automaticamente.
3. Definir segredo exclusivo, banco, hosts e origens confiáveis; desativar DEBUG; verificar HTTPS, cookies de sessão, CSRF, arquivos estáticos e acesso administrativo. Executar `python pilot/manage.py check --deploy` com configuração do ambiente alvo.
4. Rodar migrações de forma controlada. Configurar primeiro administrador por canal privado, sem credencial publicada no README, issue, log ou URL.
5. Registrar responsável de operação, canal para direitos, política de retenção de fidelidade e teste real de backup/restauração. Retenção diária configurada no Vercel Cron, protegida por `CRON_SECRET`: validação manual retornou 200 com segredo e 401 sem segredo; monitorar o primeiro disparo agendado, ainda não observado. A mesma operação deve continuar disponível pelo comando `python pilot/manage.py purge_pilot`: avaliações e pendentes sem ativação expiram em 30 dias; ledger permanece durante carteira ativa e, pseudonimizado/restrito à auditoria, por 180 dias após encerramento. Não expurgar lançamentos de carteira ativa pela idade de cada lançamento. Sem esses itens, usar somente demonstração com dados fictícios.
6. Validar administração, dois parceiros isolados, balcão, cadastro pendente, avaliação elegível e resgate concorrente no PostgreSQL alvo.
7. Registrar data, commit, URL, ambiente e resultado em evidência de release; só então informar endereço funcionando.

## Verificações de jornada

Navegar sem cadastro; mudar pt/en/es; usar teclado; ativar/desativar recursos acessíveis; enviar cadastro; confirmar estado pendente; ativar no administrador; obter crédito igual em avaliações de uma e cinco estrelas; conferir bloqueios por período/limite; aprovar benefício; resgatar no balcão; repetir requisição sem débito/estoque duplicados; confirmar isolamento entre parceiros.

No totem: encerrar ou aguardar inatividade e confirmar que outro visitante não recupera cadastro, telefone, comprovante ou sessão anterior por voltar/recarregar. VLibras não carrega em telas com dados pessoais.

## Operação dos 30 dias

Robson acompanha disponibilidade, erros, banco e limite de 100 membros/cinco parceiros; Gabriel acompanha integridade de créditos/resgates; Luis confere incidentes/reprodução; Helder decide comunicação e prioridade. Não coletar telefone/token em log para facilitar suporte.

Em falha de saldo/estoque: suspender novas operações de fidelidade, preservar evidências privadas, identificar transações afetadas e reconciliar de forma auditável. Não corrigir saldo por SQL improvisado. Em erro de release, retornar ao último artefato compatível; não reverter migração destrutiva sem plano e restauração testada.

Ao encerrar: bloquear novos créditos/cadastros conforme decisão operacional, comunicar situação dos benefícios e atender direitos/retenção segundo política publicada. Não apagar ou prolongar retenção silenciosamente. Planos gratuitos não são promessa de disponibilidade contínua.
