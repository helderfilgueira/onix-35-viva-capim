import http.client
import json
import threading
import time
import unittest
from server import AppServer, Store


class IntegrationTests(unittest.TestCase):
    def test_translator_policy_is_only_enabled_on_map(self):
        for path, allowed in [('/explorar.html?destination=f0-loja-29', True), ('/', False), ('/api/events', False)]:
            conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
            conn.request('GET',path)
            response=conn.getresponse()
            self.assertEqual(response.status,200)
            self.assertEqual('vlibras.gov.br' in response.getheader('Content-Security-Policy',''),allowed)
            response.read();conn.close()

    def setUp(self):
        self.store=Store(':memory:')
        self.server=AppServer(('127.0.0.1',0),self.store,'test-administrator-secret')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.store.db.close()

    def req(self,path,method='GET',data=None,token='',admin=False,extra=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        headers={'Content-Type':'application/json'}
        if token:headers['X-Session-Token']=token
        if admin:headers['X-Admin-Token']='test-administrator-secret'
        if extra:headers.update(extra)
        conn.request(method,path,json.dumps(data) if data is not None else None,headers)
        response=conn.getresponse();raw=response.read();code=response.status
        conn.close()
        try:return code,json.loads(raw)
        except ValueError:return code,raw

    def session(self):
        status,data=self.req('/api/session','POST',{'consent':True,'notice':'demo-v1'})
        self.assertEqual(status,201)
        return data['token']

    def participation(self,score=5):
        token=self.session()
        self.assertEqual(self.req('/api/checkins','POST',{'event_id':'musica'},token)[0],201)
        self.assertEqual(self.req('/api/reviews','POST',{'event_id':'musica','score':score,'reason':'programacao'},token)[0],201)
        return token

    def test_public_agenda_and_static_restriction(self):
        events=self.req('/api/events')[1]['events']
        self.assertEqual(len(events),12)
        self.assertEqual(len({e['id'] for e in events}),12)
        self.assertEqual(self.req('/')[0],200)
        self.assertEqual(self.req('/modern.css')[0],200)
        for path in ('/server.py','/data/demo.sqlite3','/../server.py','/%2e%2e/server.py'):
            self.assertEqual(self.req(path)[0],404)

    def test_consent_and_extra_fields(self):
        for payload in ({'consent':False,'notice':'demo-v1'}, {'consent':1,'notice':'demo-v1'}, {'consent':True,'notice':'old'}, {'consent':True,'notice':'demo-v1','email':'private@example.test'}):
            self.assertEqual(self.req('/api/session','POST',payload)[0],400)

    def test_review_validation_and_checkin_requirement(self):
        t=self.session()
        self.assertEqual(self.req('/api/reviews','POST',{'event_id':'musica','score':4,'reason':'programacao'},t)[0],409)
        self.req('/api/checkins','POST',{'event_id':'musica'},t)
        for score in (True,0,6,2.5,'5',None):
            self.assertEqual(self.req('/api/reviews','POST',{'event_id':'musica','score':score,'reason':'programacao'},t)[0],400)
        self.assertEqual(self.req('/api/reviews','POST',{'event_id':'musica','score':5,'reason':'arbitrary'},t)[0],400)
        self.assertEqual(self.req('/api/checkins','POST',{'event_id':'missing'},t)[0],404)

    def test_duplicates_isolation_export_and_delete(self):
        a=self.participation();b=self.session()
        self.assertEqual(self.req('/api/checkins','POST',{'event_id':'musica'},a)[0],409)
        self.assertEqual(self.req('/api/reviews','POST',{'event_id':'musica','score':1,'reason':'outro'},a)[0],409)
        self.assertEqual(len(self.req('/api/me',token=a)[1]['reviews']),1)
        self.assertEqual(self.req('/api/me',token=b)[1]['reviews'],[])
        self.assertEqual(self.req('/api/me',token='wrong')[0],401)
        self.assertTrue(self.req('/api/me','DELETE',token=a)[1]['deleted'])
        self.assertEqual(self.req('/api/me',token=a)[0],401)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM reviews').fetchone()[0],0)

    def test_threshold_and_deletion_recalculate(self):
        tokens=[self.participation(n) for n in (1,2,3,4)]
        row=next(x for x in self.req('/api/admin/metrics',admin=True)[1]['events'] if x['event_id']=='musica')
        self.assertIsNone(row['average']);self.assertIsNone(row['reviews'])
        tokens.append(self.participation(5))
        row=next(x for x in self.req('/api/admin/metrics',admin=True)[1]['events'] if x['event_id']=='musica')
        self.assertEqual(row['average'],3);self.assertEqual(row['reviews'],5)
        self.req('/api/me','DELETE',token=tokens[0])
        row=next(x for x in self.req('/api/admin/metrics',admin=True)[1]['events'] if x['event_id']=='musica')
        self.assertIsNone(row['average'])

    def test_admin_auth_and_schedule_conflict(self):
        self.assertEqual(self.req('/api/admin/metrics')[0],401)
        data={'title':'Evento de teste','category':'Oficina','location':'Praça A','starts':'2026-11-13T18:30:00-03:00','ends':'2026-11-13T19:30:00-03:00','description':'Conteúdo fictício.'}
        self.assertEqual(self.req('/api/admin/events','POST',data,admin=True)[0],409)
        data.update(starts='2026-11-13T19:00:00-03:00',ends='2026-11-13T20:00:00-03:00')
        self.assertEqual(self.req('/api/admin/events','POST',data,admin=True)[0],201)
        data['ends']='2026-11-13T18:00:00-03:00'
        self.assertEqual(self.req('/api/admin/events','POST',data,admin=True)[0],400)

    def test_expired_participation_retains_rights(self):
        t=self.participation()
        with self.store.db:self.store.db.execute('UPDATE sessions SET expires=?',(time.time()-1,))
        self.assertEqual(self.req('/api/checkins','POST',{'event_id':'criativa'},t)[0],401)
        self.assertEqual(self.req('/api/me',token=t)[0],200)
        self.assertEqual(self.req('/api/me','DELETE',token=t)[0],200)

    def test_retention_purges_rows(self):
        t=self.participation()
        with self.store.db:self.store.db.execute('UPDATE sessions SET created=?',(time.time()-31*86400,))
        self.assertEqual(self.req('/api/me',token=t)[0],401)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM reviews').fetchone()[0],0)

    def test_host_origin_and_body_limits(self):
        self.assertEqual(self.req('/api/events',extra={'Host':'attacker.test'})[0],403)
        self.assertEqual(self.req('/api/events',extra={'Origin':'https://attacker.test'})[0],403)
        self.assertEqual(self.req('/api/events',extra={'Sec-Fetch-Site':'cross-site'})[0],403)
        self.assertEqual(self.req('/api/session','POST',{'x':'A'*9000})[0],413)


if __name__=='__main__':unittest.main(verbosity=2)
