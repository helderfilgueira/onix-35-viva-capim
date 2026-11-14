"""Explicitly local demo bootstrap. Does not provision or publish infrastructure."""
from pathlib import Path
import os,secrets,subprocess,sys,threading,webbrowser
root=Path(__file__).resolve().parents[1]
venv=root/'.venv';exe=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
if not exe.exists():subprocess.run([sys.executable,'-m','venv',str(venv)],check=True)
subprocess.run([str(exe),'-m','pip','install','-r',str(root/'pilot/requirements.txt')],check=True)
env=os.environ.copy();env['DJANGO_DEBUG']='1';env.pop('DATABASE_URL',None)
env['PILOT_DB_PATH']=str(root/'pilot/data/local-demo.sqlite3')
manage=[str(exe),str(root/'pilot/manage.py')]
subprocess.run(manage+['migrate','--noinput'],env=env,check=True)
access=root/'.local-access.txt'
if not access.exists():
 password=secrets.token_urlsafe(20);env['PILOT_ADMIN_USERNAME']='onix-local';env['PILOT_ADMIN_PASSWORD']=password
 subprocess.run(manage+['seed_pilot'],env=env,check=True)
 access.write_text('ACESSO SOMENTE LOCAL — não compartilhe nem publique\nUsuário: onix-local\nSenha: '+password+'\nPainel: http://127.0.0.1:8879/dashboard/\n',encoding='utf8')
print('Abra .local-access.txt nesta pasta para consultar sua credencial privada.')
print('Painel local: http://127.0.0.1:8879/dashboard/ — Ctrl+C encerra o servidor.')
threading.Timer(2,lambda:webbrowser.open('http://127.0.0.1:8879/dashboard/')).start()
try:subprocess.run(manage+['runserver','127.0.0.1:8879','--noreload'],env=env,check=True)
except KeyboardInterrupt:pass
