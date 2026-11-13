import importlib.util, json, threading, unittest, http.client, pathlib, time, hashlib
p=pathlib.Path(__file__).resolve().with_name('server.py')
spec=importlib.util.spec_from_file_location('viva_server',p); app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
class ReviewTests(unittest.TestCase):
 def setUp(self):
  self.store=app.Store(':memory:');self.admin='test-only-secret-12345678';self.server=app.AppServer(('127.0.0.1',0),self.store,self.admin);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.port=self.server.server_port
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join();self.store.db.close()
 def req(self,method,path,data=None,token=None,admin=None,headers=None):
  h={'Content-Type':'application/json'}
  if token:h['X-Session-Token']=token
  if admin:h['X-Admin-Token']=admin
  if headers:h.update(headers)
  c=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5);c.request(method,path,body=json.dumps(data) if data is not None else None,headers=h);r=c.getresponse();raw=r.read();status=r.status;c.close();return status,json.loads(raw)
 def session(self):return self.req('POST','/api/session',{'consent':True,'notice':'demo-v1'})[1]['token']
 def review(self,t,score=4):
  self.req('POST','/api/checkins',{'event_id':'musica'},t)
  return self.req('POST','/api/reviews',{'event_id':'musica','score':score,'reason':'organizacao'},t)
 def test_public_without_consent(self):self.assertEqual(200,self.req('GET','/api/events')[0])
 def test_consent_strict(self):
  for c in [False,1,'true',None]:self.assertEqual(400,self.req('POST','/api/session',{'consent':c,'notice':'demo-v1'})[0])
 def test_no_extra_personal_fields(self):self.assertEqual(400,self.req('POST','/api/session',{'consent':True,'notice':'demo-v1','cpf':'fake'})[0])
 def test_invalid_scores(self):
  t=self.session()
  for score in [True,0,6,2.5,'5',None]:self.assertEqual(400,self.review(t,score)[0])
 def test_no_review_without_checkin(self):self.assertEqual(409,self.req('POST','/api/reviews',{'event_id':'musica','score':4,'reason':'outro'},self.session())[0])
 def test_duplicate_and_delete(self):
  t=self.session();self.assertEqual(201,self.review(t)[0]);self.assertEqual(409,self.review(t)[0]);self.assertEqual(1,len(self.req('GET','/api/me',token=t)[1]['reviews']));self.assertEqual(200,self.req('DELETE','/api/me',token=t)[0]);self.assertEqual(401,self.req('GET','/api/me',token=t)[0]);self.assertEqual(0,self.store.db.execute('SELECT COUNT(*) FROM reviews').fetchone()[0])
 def test_admin_auth_and_small_group(self):
  self.review(self.session());self.assertEqual(401,self.req('GET','/api/admin/metrics')[0]);self.assertEqual(401,self.req('GET','/api/admin/metrics',admin='wrong')[0]);d=self.req('GET','/api/admin/metrics',admin=self.admin)[1];m=next(x for x in d['events'] if x['event_id']=='musica');self.assertIsNone(m['average']);self.assertIsNone(m['reviews'])
 def test_threshold_and_delete(self):
  tokens=[self.session() for _ in range(5)]
  for t in tokens:self.review(t)
  def metric():return next(x for x in self.req('GET','/api/admin/metrics',admin=self.admin)[1]['events'] if x['event_id']=='musica')
  self.assertEqual(4,metric()['average']);self.assertEqual(5,metric()['reviews']);self.req('DELETE','/api/me',token=tokens[0]);self.assertIsNone(metric()['average'])
 def test_origin_host_traversal(self):
  self.assertEqual(403,self.req('GET','/api/events',headers={'Host':'evil.example'})[0]);self.assertEqual(403,self.req('POST','/api/session',{'consent':True,'notice':'demo-v1'},headers={'Origin':'https://evil.example'})[0]);self.assertEqual(404,self.req('GET','/../data/demo.sqlite3')[0])
 def test_invalid_event_and_token(self):
  self.assertEqual(404,self.req('POST','/api/checkins',{'event_id':"'; DROP TABLE events;--"},self.session())[0]);self.assertEqual(12,len(self.req('GET','/api/events')[1]['events']));self.assertEqual(401,self.req('GET','/api/me',token='A'*43)[0])
 def test_expired_token_retains_rights(self):
  t=self.session();self.review(t);self.store.db.execute('UPDATE sessions SET expires=?',(time.time()-1,));self.store.db.commit();self.assertEqual(401,self.req('POST','/api/checkins',{'event_id':'criativa'},t)[0]);self.assertEqual(200,self.req('GET','/api/me',token=t)[0]);self.assertEqual(200,self.req('DELETE','/api/me',token=t)[0])
 def test_retention(self):
  t=self.session();self.review(t);self.store.db.execute('UPDATE sessions SET created=?',(time.time()-app.RETENTION-1,));self.store.db.commit();self.req('GET','/api/events');self.assertEqual(0,self.store.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]);self.assertEqual(0,self.store.db.execute('SELECT COUNT(*) FROM reviews').fetchone()[0])
if __name__=='__main__':unittest.main(verbosity=2)
