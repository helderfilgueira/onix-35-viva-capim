# Trabalho no Viva Capim

A equipe informada é Gabriel Schimit (backend), Helder Filgueira (frontend e líder), Luis (QA) e Robson (integração e operação). Consulte o prompt mestre e a equipe no diretório superior. A prática do HackaRun escolhida é LGPD. Preserve os integrantes reais da equipe e declare assistência de IA.

## Arquitetura atual

Python 3.10+ com biblioteca padrão, SQLite e interface HTML/CSS/JavaScript. Demonstração exclusivamente local com dados fictícios. Leia README e contratos antes de editar. Não trocar stack sem decisão registrada.

## Propriedade e integração

- Backend: server.py e regras de dados.
- Frontend: static/; combinar API com backend antes de alterações.
- QA: test_server.py e test_privacy.py; não simular resultados.
- Coordenador: README, integração e empacotamento.

Não editar o mesmo arquivo simultaneamente com outro agente. Use delegação quando houver suporte; registre resultados e decisões reais.

## Invariantes

Agenda sem cadastro; consentimento voluntário; nenhuma coleta de identidade ou texto livre do visitante; tokens pseudônimos; autorização no servidor; SQL parametrizado; uma resposta por sessão/evento; direitos disponíveis durante retenção; painel agregado com limiar explícito. Não publicar banco, segredos ou planta técnica bruta.

Execute `python -m unittest -v test_server.py test_privacy.py` e valide interface quando alterar fluxos. Documente limites de segurança, acessibilidade e hardware não testados. Não transformar servidor local em produção sem arquitetura apropriada.

Há conflito entre prazo da foto e regulamento. Não falsificar datas ou afirmar submissão. O início e a admissibilidade de artefatos de cada missão seguem confirmação da organização.
