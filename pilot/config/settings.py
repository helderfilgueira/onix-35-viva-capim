import os
from pathlib import Path
from urllib.parse import urlparse, unquote
BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get('DJANGO_DEBUG', os.environ.get('DEBUG','1')) == '1'
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'local-demo-only-not-for-deployment-change-this-key')
if not DEBUG and SECRET_KEY.startswith('local-demo'):
    raise RuntimeError('Configure DJANGO_SECRET_KEY before public deployment.')
ALLOWED_HOSTS = os.environ.get('DJANGO_ALLOWED_HOSTS', os.environ.get('ALLOWED_HOSTS','localhost,127.0.0.1,testserver')).split(',')
CSRF_TRUSTED_ORIGINS = [v for v in os.environ.get('DJANGO_CSRF_TRUSTED_ORIGINS', os.environ.get('CSRF_TRUSTED_ORIGINS','')).split(',') if v]
INSTALLED_APPS = ['django.contrib.admin','django.contrib.auth','django.contrib.contenttypes','django.contrib.sessions','django.contrib.messages','django.contrib.staticfiles','core']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware','django.contrib.sessions.middleware.SessionMiddleware','django.middleware.common.CommonMiddleware','django.middleware.csrf.CsrfViewMiddleware','django.contrib.auth.middleware.AuthenticationMiddleware','django.contrib.messages.middleware.MessageMiddleware','django.middleware.clickjacking.XFrameOptionsMiddleware','core.middleware.PilotHeaders']
MIDDLEWARE.insert(1,'whitenoise.middleware.WhiteNoiseMiddleware')
ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'
TEMPLATES = [{'BACKEND':'django.template.backends.django.DjangoTemplates','DIRS':[BASE_DIR/'templates'],'APP_DIRS':True,'OPTIONS':{'context_processors':['django.template.context_processors.request','django.contrib.auth.context_processors.auth','django.contrib.messages.context_processors.messages']}}]
url = os.environ.get('DATABASE_URL', '')
if url:
    u = urlparse(url)
    if u.scheme not in ('postgres','postgresql'): raise RuntimeError('DATABASE_URL must use PostgreSQL.')
    DATABASES = {'default':{'ENGINE':'django.db.backends.postgresql','NAME':unquote(u.path.lstrip('/')),'USER':unquote(u.username or ''),'PASSWORD':unquote(u.password or ''),'HOST':u.hostname,'PORT':u.port or 5432,'CONN_MAX_AGE':0,'DISABLE_SERVER_SIDE_CURSORS':True,'OPTIONS':{'sslmode':os.environ.get('DB_SSLMODE','require'),'prepare_threshold':None}}}
else:
    if not DEBUG: raise RuntimeError('Public deployment requires PostgreSQL DATABASE_URL.')
    DATABASES = {'default':{'ENGINE':'django.db.backends.sqlite3','NAME':os.environ.get('PILOT_DB_PATH', str(BASE_DIR/'data'/'pilot.sqlite3')),'OPTIONS':{'timeout':20}}}
    Path(DATABASES['default']['NAME']).parent.mkdir(parents=True, exist_ok=True)
AUTH_PASSWORD_VALIDATORS = [{'NAME':'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},{'NAME':'django.contrib.auth.password_validation.MinimumLengthValidator','OPTIONS':{'min_length':10}},{'NAME':'django.contrib.auth.password_validation.CommonPasswordValidator'},{'NAME':'django.contrib.auth.password_validation.NumericPasswordValidator'}]
LANGUAGE_CODE = 'pt-br'
TIME_ZONE = 'America/Araguaina'
USE_I18N = True
USE_TZ = True
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR/'staticfiles'
STATICFILES_DIRS = [BASE_DIR/'static'] if (BASE_DIR/'static').exists() else []
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_AGE = 1800
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SECURE_SSL_REDIRECT = not DEBUG
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO','https') if os.environ.get('TRUST_HTTPS_PROXY') == '1' else None
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
DATA_UPLOAD_MAX_MEMORY_SIZE = 450000
CSRF_FAILURE_VIEW = 'core.views.csrf_failure'
LEGACY_DIR = BASE_DIR.parent/'laboratorio'
PILOT_OPERATIONS_ENABLED = os.environ.get('PILOT_OPERATIONS_ENABLED','1') == '1'
CRON_SECRET = os.environ.get('CRON_SECRET','')
