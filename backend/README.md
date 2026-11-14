# Backend Viva Capim

API inicial do Viva Capim em Python, FastAPI e PostgreSQL.

## Requisitos

- Python 3.11+
- Docker Desktop com Docker Compose

## Executar localmente

No terminal, entre na pasta `backend`:

```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
docker compose up -d
uvicorn app.main:app --reload
```

A API ficará disponível em `http://127.0.0.1:8000`. A documentação interativa fica em `http://127.0.0.1:8000/docs`.

## Configuração local

Ajuste `.env` antes de executar. O canal do totem exige o segredo `GATEWAY_SHARED_SECRET`, a origem `KIOSK_ORIGIN` e os cabeçalhos internos encaminhados pelo gateway:

- `X-Gateway-Token`
- `X-Verified-Device-Id`

O segundo cabeçalho só pode ser inserido por um gateway confiável depois de validar o certificado mTLS do equipamento. Não exponha a API diretamente à internet nem permita que o navegador defina esses cabeçalhos.

## Banco de dados

O PostgreSQL é iniciado pelo Docker Compose. Em ambiente local, as tabelas são criadas automaticamente quando a API inicia. Não use essa criação automática como estratégia de migração em produção.

Para testar rotas de totem, cadastre previamente um dispositivo e um local no banco. O identificador do dispositivo deve ser enviado pelo gateway de desenvolvimento em `X-Verified-Device-Id`.

## Implementado nesta versão

- Catálogo público e catálogo autenticado do totem.
- Configuração do dispositivo.
- Reset de geração e revogação das sessões anteriores.
- Criação de sessão com aviso de privacidade aceito.
- Renovação por interação explícita.
- Participação autodeclarada e avaliação estruturada.
- Idempotência de envios por sessão.
- Consulta do estado de envio na própria sessão.
- Encerramento da sessão.
- Métricas agregadas com supressão de grupos pequenos.

## Antes de piloto ou produção

Esta é uma primeira implementação funcional de desenvolvimento, não uma implantação pronta para uso real. Ainda precisam ser concluídos e validados: gateway mTLS e provisionamento/rotação/revogação de certificados; autenticação humana administrativa com MFA e RBAC; CRUD administrativo de eventos e auditoria; portal de direitos com recibos e exclusão; migrations; testes automatizados e de concorrência; política aprovada de retenção, controlador e aviso; limites de requisição, monitoramento e backup. A coleta real deve permanecer desabilitada até essas definições e controles serem aprovados.
