# Jira e Confluence | Equipe Onix - 35

Kit para implantação pela equipe. **ONIX35** é a chave sugerida. Se o projeto real tiver outra chave, substitua `ONIX35` nos filtros e links. B01 a B16 são IDs de planejamento; as chaves do Jira são geradas na importação.

## 0. Criar o ambiente da equipe do zero

O PDF está pronto para revisão e envio da Missão 1. Faça a configuração abaixo quando a equipe puder acessar os serviços.

1. Robson ou Helder abre o [cadastro oficial do Jira Free](https://www.atlassian.com/br/try/cloud/signup?bundle=jira-software&edition=free), entra com a conta que vai administrar o projeto e escolhe um nome de site disponível. A Atlassian informa que o plano Free atende até dez pessoas. Guarde a URL que o cadastro gerar; ela será o endereço da equipe.
2. No Jira, escolha criar um projeto/espaço de software com [modelo Scrum](https://www.atlassian.com/software/jira/templates/scrum). Use **Viva Capim | Equipe Onix - 35** como nome e **ONIX35** como chave, se disponível. Se a configuração oferecer gerenciamento pela empresa ou pela equipe, escolha pela empresa quando quiser o Sprint Report nativo. O quadro gerenciado pela equipe também serve para começar com filtros e macros.
3. Na mesma organização, adicione Confluence ao site, se ainda não estiver ativo. Use o [cadastro do Confluence Free](https://www.atlassian.com/try/cloud/signup?bundle=confluence&edition=free) com a mesma conta e selecione o site já criado, se a tela oferecer essa escolha. Se não aparecer, siga [Adicionar app na administração Atlassian](https://support.atlassian.com/organization-administration/docs/add-a-new-product-to-your-organization/) e confira o plano em Assinaturas. Escolha **Free** para o time de quatro pessoas; a administração pode apresentar um teste de plano pago como opção. Use o Confluence como base da equipe.
4. Adicione os quatro membros com as contas que eles usam. Em um site Free, os controles de acesso do Confluence são limitados; use um ambiente do time e mantenha apenas quem precisa acessar. [Detalhes dos planos](https://support.atlassian.com/confluence-cloud/docs/learn-about-confluence-cloud-plans/).
5. Descompacte o pacote. A primeira meta é importar o CSV no Jira e criar a página principal do Confluence com o PDF. Depois adicione as páginas filhas, os fluxos e a visão de review conforme os passos seguintes.

## 1. Jira: criar o quadro e carregar o backlog

1. Robson e o administrador local escolhem o projeto autorizado. Use Jira Software com quadro Scrum; o formato gerenciado pela empresa é preferível quando a equipe precisar do Sprint Report nativo.
2. Confirme tipos equivalentes a **Task** e **Story** e o fluxo **A iniciar → Em andamento → Em revisão → Concluído**. Mapeie a última coluna para status da categoria Concluído. Se o quadro não tiver uma coluna própria de revisão, registre a transição equivalente antes de usar o relatório.
3. No destino autorizado, abra **Configurações → Sistema → Importação de sistemas externos → CSV**. Use `01_Backlog_Importacao_Jira.csv` (UTF-8; delimitador vírgula). Se usar o importador de criação em massa, siga as permissões e o fluxo disponíveis no seu Jira.
4. Mapeie `Summary` → Resumo, `WorkType` → Tipo, `Description` → Descrição, `Priority` → Prioridade. Mapeie `ProjectLabel`, `PhaseLabel`, `BacklogLabel` e `PriorityLabel` para **Etiquetas/Labels** quando o importador oferecer múltiplas colunas. Se aceitar só uma, use `ProjectLabel` como mínimo; fase, ID e prioridade também estão na descrição.
5. No mapeamento de valores, associe P0/P1/P2 às três prioridades existentes que representem a ordem correta, por exemplo High/Medium/Low, e Task/Story aos tipos configurados. A prioridade interna P0/P1/P2 permanece na etiqueta e descrição. Sem status mapeado, confira que o padrão corresponde a A iniciar.
6. Revise o destino e a prévia. Antes de importar, busque `project = ONIX35 AND labels = onix35`; se já houver itens, confira B01 a B16 e importe só os ausentes. O CSV cria itens novos e não atualiza os já criados.
7. Confirme **16 itens**. Preencha as chaves geradas e os responsáveis reais em `02_Mapeamento_Pos_Importacao.csv`. Atribua cada conta no Jira. Use `03_Dependencias.csv` para criar os vínculos **depende de / is blocked by** quando disponíveis. Não use B01–B16 como chaves reais.
8. Reordene o backlog pelas prioridades, dependências e capacidade; a ordem de Rank vem do quadro. Salve os filtros de `04_Filtros_JQL.txt` com acesso da equipe. Use a bandeira de impedimento, com motivo, dono e próxima ação no item.
9. Crie sprints a partir da seção de planejamento. Selecione itens conforme capacidade e lançamento oficial. Ative apenas a sprint correspondente e registre o ID real na página do Confluence.

### Evidências a registrar

- Link do quadro e do filtro do projeto; resultado do importador; verificação de contagem e de dois itens com aceite/dependência.
- Chaves reais, responsáveis, links das páginas oficiais e revisão de acesso de um membro.
- Se já houver tarefas da equipe, preserve histórico; o CSV é uma carga inicial para os itens ausentes.

## 2. Confluence: publicar a base da equipe

1. Em espaço autorizado, crie a página principal **Viva Capim | Equipe Onix - 35**. Em seguida, crie seis páginas filhas na ordem dos arquivos de `Confluence/`.
2. Abra os HTML localmente; copie o conteúdo visível do artigo para o editor. Revise títulos, tabelas e listas. Os links do rodapé são apenas de navegação local; vincule as páginas reais no Confluence.
3. Anexe o PDF consolidado à página inicial; em Produto, anexe `PROPOSTA_VISUAL_2026.png`, `Telas_do_Totem.png`, D01 e D06. Em Arquitetura, anexe D02–D04 e `CONTRATOS_TOTENS.json`; em Planejamento, anexe D05. Use PNG na página e mantenha o SVG como fonte editável. Não é necessário instalar macro Mermaid para ver os fluxos.
4. Ligue cada tarefa ao documento oficial (URL real) e cada requisito/decisão às tarefas correspondentes. Em arquivos e evidências de QA, use dados fictícios ou agregados; não copie credenciais ou respostas de visitantes.
5. Confirme permissões para os quatro membros e revise a visualização usando uma conta de membro do projeto. Quem não pode ler o Jira pode não ver as listas e contagens vinculadas.

## 3. Relatório de review a partir do Jira

1. Em **Review e relatório**, insira `/jira` → **Jira work items**. Selecione a instância vinculada e informe a consulta em JQL. Para cada indicador em modo contagem, use a opção de contagem do macro; para impedimentos, use lista.
2. Use as consultas `sprint`, `concluidos`, `pendentes` e `impedimentos` de `04_Filtros_JQL.txt`. Para o backlog completo use `escopo`. Compare, com a mesma conta e a mesma consulta, o resultado da busca no Jira e no macro. Ajuste chave, labels e configuração de status se houver diferença.
3. No dashboard Jira, se disponível, adicione **Filter Results** para impedimentos e **Two Dimensional Filter Statistics** para responsável × status, com o filtro da sprint. No quadro Scrum gerenciado pela empresa, consulte **Reports → Sprint Report** e confira a coluna final.
4. No encerramento, anote ID da sprint, data/hora, total no recorte, concluídos, pendentes, bloqueados, decisões e evidências. Para consultar sprint fechada, use `sprint = ID_REAL` em vez de `sprint in openSprints()`. A ata preserva a contagem observada; a consulta ao vivo pode mudar com novas transições.
5. Se o macro não estiver disponível, coloque o link do filtro salvo e registre manualmente as contagens conferidas. A ata continua sendo a referência para decisões e ações da equipe.

## Referências de configuração

- [Atlassian Support. Importar itens CSV para um espaço Jira Cloud existente.](https://support.atlassian.com/jira-software-cloud/docs/import-issues-into-an-existing-space-in-jira-using-csv/)
- [Atlassian Support. Criar itens com o importador CSV.](https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/)
- [Atlassian Support. Exibir itens do Jira no Confluence.](https://support.atlassian.com/confluence-cloud/docs/insert-the-jira-issues-macro/)
- [Atlassian Support. Sprint Report no Jira Cloud.](https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-sprint-report/)
- [Atlassian Support. Funções de JQL.](https://support.atlassian.com/jira-software-cloud/docs/jql-functions/)
- [Atlassian Support. Sinalizar um item bloqueado no Jira.](https://support.atlassian.com/jira-software-cloud/docs/flag-an-issue/)
- [Atlassian Support. Criar, organizar e publicar conteúdo no Confluence.](https://support.atlassian.com/confluence-cloud/docs/create-edit-and-publish-a-page/)
- [Atlassian Support. Gadgets dos painéis Jira.](https://support.atlassian.com/jira-cloud-administration/docs/use-dashboard-gadgets/)
