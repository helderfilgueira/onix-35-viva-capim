# Backend Viva Capim

API do Viva Capim em Python, FastAPI e PostgreSQL.

## Requisitos

- Python 3.11 ou superior
- Docker com Docker Compose

## Executar no Codespaces ou Linux

Na raiz do repositório:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
docker compose up -d
```

Configure um segredo local forte em `.env` para `GATEWAY_SHARED_SECRET` e mantenha `KIOSK_ORIGIN=http://localhost:5173` para o script de teste. Não compartilhe o arquivo `.env`.

Inicie a API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

A documentação fica em `/docs`.

## Preparar dispositivo de desenvolvimento

Em outro terminal, na pasta `backend`, com o ambiente virtual ativado:

```bash
python -m scripts.dev_seed
```

O script cria (ou reutiliza) um local e um dispositivo de desenvolvimento e imprime o UUID do dispositivo. É uma identidade de teste local; não representa provisionamento real nem certificado mTLS.

## Testar o fluxo de ponta a ponta

O teste exige pelo menos um evento futuro publicado e aprovado no banco. Pode ser criado no ambiente de desenvolvimento com SQL ou por uma futura interface administrativa.

Defina o segredo em `.env` e copie o mesmo valor para o argumento `--gateway-token`. O script simula o cabeçalho interno do gateway; não substitui o gateway mTLS real.

```bash
python -m scripts.smoke_kiosk \
  --base-url "https://SEU-CODESPACE-8000.app.github.dev" \
  --device-id "UUID_IMPRESSO_PELO_DEV_SEED" \
  --gateway-token "MESMO_SEGREDO_DO_ENV"
```

O script percorre catálogo do totem, configuração, criação de sessão, atualização de atividade, participação, avaliação, recibo idempotente e encerramento da sessão. Ele cria registros de teste no banco.

## Segurança do canal do totem

O canal do totem exige `GATEWAY_SHARED_SECRET`, a origem configurada em `KIOSK_ORIGIN` e os cabeçalhos internos:

- `X-Gateway-Token`
- `X-Verified-Device-Id`

O segundo cabeçalho só pode ser inserido por um gateway confiável depois de validar o certificado mTLS do equipamento. O script de smoke test simula esse gateway somente em desenvolvimento. Não exponha a API diretamente à internet nem permita que o navegador defina esses cabeçalhos.

## Implementado nesta versão

- Catálogo público e catálogo do totem.
- Configuração do dispositivo.
- Reset de geração e revogação de sessões anteriores.
- Criação de sessão com aviso de privacidade aceito.
- Renovação por interação explícita.
- Participação autodeclarada e avaliação estruturada.
- Idempotência de envios por sessão.
- Consulta do estado de envio na própria sessão.
- Encerramento da sessão.
- Métricas agregadas com supressão de grupos pequenos.
- Semeador de dispositivo de desenvolvimento e script de smoke test do fluxo do totem.

## Antes de piloto ou produção

Esta versão continua sendo uma implementação de desenvolvimento, não uma implantação pronta para uso real. Ainda precisam ser concluídos e validados: gateway mTLS e provisionamento/rotação/revogação de certificados; autenticação humana administrativa com MFA e RBAC; CRUD administrativo de eventos e auditoria; portal de direitos com recibos e exclusão; migrations; testes automatizados e de concorrência; política aprovada de retenção, controlador e aviso; limites de requisição, monitoramento e backup. A coleta real deve permanecer desabilitada até essas definições e controles serem aprovados.
