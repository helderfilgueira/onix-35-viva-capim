"""Viva Capim - demonstracao local, somente biblioteca padrao Python 3.10+."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from navigation import load_navigation, calculate_route, NavigationError

ROOT = Path(__file__).resolve().parent
REASONS = ('programacao', 'localizacao', 'acessibilidade', 'organizacao', 'outro')
LOCATIONS = ('Praça A', 'Praça B', 'Praça C')
STORE_REASONS = ('atendimento', 'produtos', 'ambiente', 'acessibilidade', 'outro')
STORE_NOTICE = 'store-review-v1'
RATING_THRESHOLD = 5
SESSION_TTL = 86400
RETENTION = 30 * 86400


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.lock = threading.RLock()
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,title TEXT NOT NULL,
        category TEXT NOT NULL,location TEXT NOT NULL,starts TEXT NOT NULL,ends TEXT NOT NULL,
        description TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,created REAL NOT NULL,
        expires REAL NOT NULL,notice TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS checkins(session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id),created REAL NOT NULL,
        PRIMARY KEY(session_id,event_id));
        CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        event_id TEXT REFERENCES events(id),score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
        reason TEXT NOT NULL,created REAL NOT NULL,UNIQUE(session_id,event_id));
        CREATE TABLE IF NOT EXISTS store_consents(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        notice TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS store_checkins(session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        store_id TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(session_id,store_id));
        CREATE TABLE IF NOT EXISTS store_reviews(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,
        store_id TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
        reason TEXT NOT NULL CHECK(reason IN ('atendimento','produtos','ambiente','acessibilidade','outro')),
        created REAL NOT NULL,UNIQUE(session_id,store_id),
        FOREIGN KEY(session_id,store_id) REFERENCES store_checkins(session_id,store_id) ON DELETE CASCADE);
        ''')
        if not self.db.execute('SELECT 1 FROM events').fetchone():
            self.db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?,?)', [
                ('musica','Sons do Cerrado','Música','Praça A','2026-11-13T18:00:00-03:00','2026-11-13T19:00:00-03:00','Uma pausa para ouvir música e descobrir novos encontros. Evento fictício para demonstração.'),
                ('criativa','Ateliê de ideias','Oficina','Praça B','2026-11-13T16:00:00-03:00','2026-11-13T17:00:00-03:00','Uma experiência criativa para experimentar materiais e imaginar possibilidades. Evento fictício para demonstração.'),
                ('sabores','Sabores da nossa terra','Gastronomia','Praça C','2026-11-14T17:00:00-03:00','2026-11-14T18:00:00-03:00','Um encontro de histórias e sabores do Tocantins. Evento fictício para demonstração.')])
        # Additional synthetic experiences make progressive browsing demonstrable.
        # Keep existing rows and visitor records intact when upgrading the demo.
        extras = [
            ('cultura-roda','Histórias que nos encontram','Cultura','Praça A','2026-11-15T15:00:00-03:00','2026-11-15T16:00:00-03:00','Uma roda de histórias e imaginação para descobrir outros pontos de vista.'),
            ('jardim','Um jardim de possibilidades','Oficina','Praça B','2026-11-15T16:00:00-03:00','2026-11-15T17:00:00-03:00','Coloque a criatividade na terra e imagine seu pequeno jardim.'),
            ('pausa','Uma pausa para respirar','Bem-estar','Praça C','2026-11-15T17:00:00-03:00','2026-11-15T18:00:00-03:00','Um momento tranquilo para desacelerar e aproveitar o presente.'),
            ('acustico','Fim de tarde acústico','Música','Praça A','2026-11-16T17:00:00-03:00','2026-11-16T18:00:00-03:00','Canções, encontros e um fim de tarde com outro ritmo.'),
            ('cafe','Entre cafés e conversas','Gastronomia','Praça B','2026-11-16T16:00:00-03:00','2026-11-16T17:00:00-03:00','Uma experiência sensorial para quem gosta de boas conversas.'),
            ('troca','Encontro de boas ideias','Encontros','Praça C','2026-11-16T18:00:00-03:00','2026-11-16T19:00:00-03:00','Pessoas e ideias diferentes no mesmo lugar. Venha imaginar possibilidades.'),
            ('cores','O Cerrado em outras cores','Cultura','Praça A','2026-11-17T15:00:00-03:00','2026-11-17T16:00:00-03:00','Uma proposta visual inspirada nas formas e nas cores da nossa região.'),
            ('papel','Pequenas invenções em papel','Oficina','Praça B','2026-11-17T16:00:00-03:00','2026-11-17T17:00:00-03:00','Dobre, descubra e transforme uma folha em algo inesperado.'),
            ('ritmo','Movimento no seu ritmo','Bem-estar','Praça C','2026-11-17T17:00:00-03:00','2026-11-17T18:00:00-03:00','Uma proposta de movimento leve, com espaço para respeitar o seu ritmo.')]
        self.db.executemany('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)',
                            [(*r[:-1], r[-1]+' Evento fictício para demonstração.') for r in extras])
        self.db.commit()

    def cleanup(self):
        # Retenção demonstrativa configurada: eliminação após 30 dias, ao receber requisições.
        with self.lock, self.db:
            self.db.execute('DELETE FROM sessions WHERE created < ?', (time.time()-RETENTION,))

    def session(self, token, allow_expired=False):
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', token or ''):
            raise Problem(401, 'Crie uma sessão de participação para continuar.')
        sid = hashlib.sha256(token.encode()).hexdigest()
        row = self.db.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        if not row or (not allow_expired and row['expires'] < time.time()):
            raise Problem(401, 'Sessão expirada ou encerrada. Inicie uma nova participação.')
        return sid


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, store, admin_token):
        load_navigation()  # Fail before binding if the published navigation data is invalid.
        self.store, self.admin_token = store, admin_token
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = 'VivaCapimDemo'
    def log_message(self, *args):
        pass  # Não registrar IP, token ou corpo das requisições.

    def reply(self, code, data, mime='application/json; charset=utf-8'):
        raw = json.dumps(data, ensure_ascii=False).encode() if isinstance(data, (dict,list)) else data
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

    def body(self, allowed):
        if self.headers.get('Content-Type','').split(';')[0] != 'application/json':
            raise Problem(415, 'Envie application/json.')
        try: size = int(self.headers.get('Content-Length','0'))
        except ValueError: raise Problem(400,'Tamanho inválido.')
        if not 0 < size <= 8192: raise Problem(413,'Corpo vazio ou muito grande.')
        try: data = json.loads(self.rfile.read(size))
        except (ValueError, UnicodeDecodeError): raise Problem(400,'JSON inválido.')
        if not isinstance(data,dict) or set(data)-set(allowed):
            raise Problem(400,'Campos não permitidos. Não envie dados pessoais.')
        return data

    def admin(self):
        if not secrets.compare_digest(self.headers.get('X-Admin-Token',''),self.server.admin_token):
            raise Problem(401,'Credencial administrativa inválida.')

    def retail_store(self, store_id):
        if not isinstance(store_id, str):
            raise Problem(404, 'Loja não encontrada no catálogo.')
        item = next((s for s in load_navigation()['stores'] if s['id'] == store_id), None)
        if not item or item.get('unit_type') in ('facility', 'structure'):
            raise Problem(404, 'Loja não encontrada no catálogo.')
        return item

    def store_consent(self, db, sid):
        row = db.execute('SELECT notice FROM store_consents WHERE session_id=?', (sid,)).fetchone()
        if not row or row['notice'] != STORE_NOTICE:
            raise Problem(403, 'Avaliar lojas é opcional e exige aceite específico do aviso store-review-v1.')

    def route(self):
        host = self.headers.get('Host','')
        allowed_hosts = {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if host not in allowed_hosts: raise Problem(403,'Host não permitido.')
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{h}' for h in allowed_hosts}:
            raise Problem(403,'Origem não permitida.')
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise Problem(403,'Requisição entre sites não permitida.')
        path = urlsplit(self.path).path
        method = self.command
        store = self.server.store
        store.cleanup()
        with store.lock:
            db = store.db
            if method == 'GET' and path == '/api/navigation':
                return self.reply(200, load_navigation())
            if method == 'POST' and path == '/api/routes':
                data = self.body(('origin', 'destination', 'accessible', 'map_version'))
                try:
                    return self.reply(200, calculate_route(data))
                except NavigationError as exc:
                    raise Problem(exc.status, exc.message)
            if method == 'GET' and path == '/api/events':
                return self.reply(200,{'events':[dict(r) for r in db.execute('SELECT * FROM events ORDER BY starts')], 'demo':True})
            if method == 'POST' and path == '/api/session':
                data=self.body(('consent','notice'))
                notice = data.get('notice')
                if data.get('consent') is not True or notice not in ('demo-v1', STORE_NOTICE):
                    raise Problem(400,'A participação é opcional. Leia e aceite o aviso específico da finalidade.')
                token=secrets.token_urlsafe(32); now=time.time();sid=hashlib.sha256(token.encode()).hexdigest()
                with db:
                    db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(sid,now,now+SESSION_TTL,notice))
                    if notice == STORE_NOTICE:
                        db.execute('INSERT INTO store_consents VALUES(?,?,?)',(sid,STORE_NOTICE,now))
                return self.reply(201,{'token':token,'expires_in':SESSION_TTL,'notice':notice})
            if method == 'GET' and path == '/api/store-ratings':
                params = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                if set(params) != {'store_id'} or len(params['store_id']) != 1:
                    raise Problem(400,'Informe somente store_id para consultar a nota da loja.')
                item = self.retail_store(params['store_id'][0])
                count, average = db.execute('SELECT count(*),avg(score) FROM store_reviews WHERE store_id=?',(item['id'],)).fetchone()
                visible = count >= RATING_THRESHOLD
                return self.reply(200,{'store_id':item['id'],'average':round(average,2) if visible else None,
                    'count':count if visible else None,'status':'disponivel' if visible else 'amostra_insuficiente',
                    'threshold':RATING_THRESHOLD,'demo':True,'source':'local_demo',
                    'unit':'sessões por loja; não pessoas únicas',
                    'warning':'Avaliações locais desta demonstração; sem dados do Google. A supressão de amostras pequenas não garante anonimização.'})
            if path in ('/api/store-consent','/api/store-checkins','/api/store-reviews') and method == 'POST':
                sid=store.session(self.headers.get('X-Session-Token',''))
                if path == '/api/store-consent':
                    data=self.body(('consent','notice'))
                    if data.get('consent') is not True or data.get('notice') != STORE_NOTICE:
                        raise Problem(400,'Leia e aceite voluntariamente o aviso store-review-v1.')
                    with db:
                        db.execute('INSERT OR IGNORE INTO store_consents VALUES(?,?,?)',(sid,STORE_NOTICE,time.time()))
                    return self.reply(200,{'consented':True,'notice':STORE_NOTICE})
                self.store_consent(db,sid)
                data=self.body(('store_id','visited') if path == '/api/store-checkins' else ('store_id','score','reason'))
                item=self.retail_store(data.get('store_id'));store_id=item['id']
                if path == '/api/store-checkins':
                    if data.get('visited') is not True:
                        raise Problem(400,'Confirme a visita de forma autodeclarada para avaliar. Isso não comprova presença física.')
                    try:
                        with db: db.execute('INSERT INTO store_checkins VALUES(?,?,?)',(sid,store_id,time.time()))
                    except sqlite3.IntegrityError:
                        raise Problem(409,'Esta sessão já confirmou uma visita a esta loja.')
                    return self.reply(201,{'checked_in':True,'store_id':store_id,'self_reported':True})
                if type(data.get('score')) is not int or not 1 <= data['score'] <= 5 or data.get('reason') not in STORE_REASONS:
                    raise Problem(400,'Escolha uma nota inteira de 1 a 5 e um aspecto válido.')
                if not db.execute('SELECT 1 FROM store_checkins WHERE session_id=? AND store_id=?',(sid,store_id)).fetchone():
                    raise Problem(409,'Confirme sua visita antes de avaliar a loja.')
                receipt=secrets.token_hex(8)
                try:
                    with db: db.execute('INSERT INTO store_reviews VALUES(?,?,?,?,?,?)',(receipt,sid,store_id,data['score'],data['reason'],time.time()))
                except sqlite3.IntegrityError:
                    raise Problem(409,'Esta sessão já avaliou esta loja.')
                return self.reply(201,{'receipt':receipt,'store_id':store_id,'message':'Avaliação registrada nesta demonstração. Obrigado pela participação voluntária.'})
            if path in ('/api/me','/api/checkins','/api/reviews'):
                sid=store.session(self.headers.get('X-Session-Token',''),allow_expired=path=='/api/me' and method in ('GET','DELETE'))
                if method=='GET' and path=='/api/me':
                    return self.reply(200,{'notice':db.execute('SELECT notice FROM sessions WHERE id=?',(sid,)).fetchone()['notice'],'retention_days':30,
                        'checkins':[dict(r) for r in db.execute('SELECT event_id,created FROM checkins WHERE session_id=?',(sid,))],
                        'reviews':[dict(r) for r in db.execute('SELECT id,event_id,score,reason,created FROM reviews WHERE session_id=?',(sid,))],
                        'store_consents':[dict(r) for r in db.execute('SELECT notice,created FROM store_consents WHERE session_id=?',(sid,))],
                        'store_checkins':[dict(r) for r in db.execute('SELECT store_id,created FROM store_checkins WHERE session_id=?',(sid,))],
                        'store_reviews':[dict(r) for r in db.execute('SELECT id,store_id,score,reason,created FROM store_reviews WHERE session_id=?',(sid,))]})
                if method=='DELETE' and path=='/api/me':
                    with db: db.execute('DELETE FROM sessions WHERE id=?',(sid,))
                    return self.reply(200,{'deleted':True,'message':'Sessão, check-ins e avaliações excluídos desta base.'})
                if method=='POST' and path in ('/api/checkins','/api/reviews'):
                    if db.execute('SELECT notice FROM sessions WHERE id=?',(sid,)).fetchone()['notice'] != 'demo-v1':
                        raise Problem(403,'A participação em eventos exige aceite específico do aviso demo-v1.')
                    data=self.body(('event_id',) if path.endswith('checkins') else ('event_id','score','reason'))
                    eid=data.get('event_id')
                    if not isinstance(eid,str) or not db.execute('SELECT 1 FROM events WHERE id=?',(eid,)).fetchone():
                        raise Problem(404,'Evento não encontrado.')
                    if path.endswith('checkins'):
                        try:
                            with db: db.execute('INSERT INTO checkins VALUES(?,?,?)',(sid,eid,time.time()))
                        except sqlite3.IntegrityError: raise Problem(409,'Esta sessão já confirmou participação neste evento.')
                        return self.reply(201,{'checked_in':True,'event_id':eid})
                    if type(data.get('score')) is not int or not 1<=data['score']<=5 or data.get('reason') not in REASONS:
                        raise Problem(400,'Escolha uma nota de 1 a 5 e um motivo válido.')
                    if not db.execute('SELECT 1 FROM checkins WHERE session_id=? AND event_id=?',(sid,eid)).fetchone():
                        raise Problem(409,'Confirme sua participação antes de avaliar.')
                    receipt=secrets.token_hex(8)
                    try:
                        with db: db.execute('INSERT INTO reviews VALUES(?,?,?,?,?,?)',(receipt,sid,eid,data['score'],data['reason'],time.time()))
                    except sqlite3.IntegrityError: raise Problem(409,'Esta sessão já avaliou este evento.')
                    return self.reply(201,{'receipt':receipt,'message':'Obrigado. Sua opinião ajuda a planejar os próximos encontros.'})
            if path.startswith('/api/admin/'):
                self.admin()
                if method=='GET' and path=='/api/admin/metrics':
                    rows=[]
                    for e in db.execute('SELECT id,title FROM events ORDER BY starts').fetchall():
                        n,avg=db.execute('SELECT count(*),avg(score) FROM reviews WHERE event_id=?',(e['id'],)).fetchone()
                        c=db.execute('SELECT count(*) FROM checkins WHERE event_id=?',(e['id'],)).fetchone()[0]
                        rows.append({'event_id':e['id'],'title':e['title'],'reviews':n if n>=5 else None,
                          'average':round(avg,2) if n>=5 else None,'checkins':c if c>=5 else None,
                          'status':'disponivel' if n>=5 else 'amostra_insuficiente'})
                    return self.reply(200,{'events':rows,'threshold':5,'unit':'sessões por evento; não pessoas únicas',
                        'warning':'Supressão simples reduz exposição, mas não garante anonimização. Não há filtros por perfil ou horário.'})
                if method=='POST' and path=='/api/admin/events':
                    data=self.body(('title','category','location','starts','ends','description'))
                    for field,limit in [('title',80),('category',40),('description',600)]:
                        if not isinstance(data.get(field),str) or not 2<=len(data[field].strip())<=limit:
                            raise Problem(400,f'Campo {field} inválido (2 a {limit} caracteres).')
                        data[field]=data[field].strip()
                    if data.get('location') not in LOCATIONS: raise Problem(400,'Local inválido.')
                    try:
                        start,end=(datetime.fromisoformat(data.get(k,'')) for k in ('starts','ends'))
                        if start.tzinfo is None or end.tzinfo is None or end<=start: raise ValueError()
                        if (end-start).total_seconds()>86400: raise ValueError()
                    except (ValueError,TypeError): raise Problem(400,'Datas devem ter fuso, fim após início e duração máxima de 24 horas.')
                    for row in db.execute('SELECT starts,ends FROM events WHERE location=?',(data['location'],)):
                        if start<datetime.fromisoformat(row['ends']) and end>datetime.fromisoformat(row['starts']):
                            raise Problem(409,'Já existe um evento neste local e intervalo.')
                    eid=secrets.token_hex(6)
                    with db: db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',(eid,data['title'],data['category'],data['location'],start.isoformat(),end.isoformat(),data['description']))
                    return self.reply(201,{'id':eid})
            if method == 'GET' and re.fullmatch(r'/logos/[a-z0-9]+\.(png|jpg|jpeg|svg|webp)', path):
                file = ROOT/'static'/path[1:]
                if not file.is_file():
                    raise Problem(404, 'Logomarca não encontrada.')
                mime = {'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','svg':'image/svg+xml','webp':'image/webp'}[file.suffix[1:]]
                return self.reply(200, file.read_bytes(), mime)
            if method=='GET' and path in ('/','/index.html','/app.js','/style.css','/modern.css','/explorar.html','/explorar.css','/explorar.js','/map3d.js','/map-plan3d.js','/brand-logos.js','/store-reviews.js','/store-reviews.css','/vendor/three.module.js','/vendor/three.core.js','/vendor/qrcode.js'):
                name='index.html' if path=='/' else path[1:]
                mime={'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8'}[name.rsplit('.',1)[1]]
                file = ROOT/'static'/name
                if not file.is_file():
                    raise Problem(404, 'Recurso não encontrado.')
                return self.reply(200,file.read_bytes(),mime)
            raise Problem(404,'Recurso não encontrado.')

    def dispatch(self):
        self.connection.settimeout(10)
        try: self.route()
        except Problem as exc: self.reply(exc.status,{'error':exc.message})
        except (BrokenPipeError,ConnectionResetError,TimeoutError): pass
        except Exception:
            self.reply(500,{'error':'Falha interna. Nenhuma informação técnica foi exposta.'})
    do_GET=do_POST=do_DELETE=dispatch


def main():
    folder=ROOT/'data'; folder.mkdir(exist_ok=True)
    token=os.environ.get('VIVA_ADMIN_TOKEN') or secrets.token_urlsafe(24)
    if len(token)<16: raise SystemExit('VIVA_ADMIN_TOKEN precisa ter ao menos 16 caracteres.')
    server=AppServer(('127.0.0.1',int(os.environ.get('VIVA_PORT','8765'))),Store(folder/'demo.sqlite3'),token)
    print(f'Viva Capim DEMO: http://127.0.0.1:{server.server_port}',flush=True)
    print(f'Credencial administrativa desta execução: {token}',flush=True)
    print('Somente demonstração local. Ctrl+C encerra. Não use dados pessoais reais.',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close(); server.store.db.close()


if __name__=='__main__': main()
