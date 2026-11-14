#!/bin/sh
# Build da Vercel: em PRODUÇÃO aplica migrações pendentes ANTES de publicar a nova versão.
# Se a migração falhar, o build falha e o deployment anterior continua no ar (nada quebra).
# Previews não tocam o banco. Credenciais vêm só das variáveis de ambiente da Vercel.
set -e
if [ "$VERCEL_ENV" = "production" ]; then
  python3 -m venv /tmp/viva-migrate
  /tmp/viva-migrate/bin/pip install --quiet --disable-pip-version-check -r requirements.txt
  /tmp/viva-migrate/bin/python pilot/manage.py migrate --noinput
  /tmp/viva-migrate/bin/python pilot/manage.py showmigrations core | tail -4
else
  echo "Build de preview: migrações não executadas."
fi
