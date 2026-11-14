import json, hashlib
from datetime import timedelta
from unittest import mock, skipUnless
from concurrent.futures import ThreadPoolExecutor
from django.test import TestCase, TransactionTestCase, Client, override_settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import connection, connections
from django.utils import timezone
from .models import Organization,StaffProfile,Member,Benefit,Event,Content,Review,Ledger,Redemption,Audit,RateBucket
from .services import create_review,redeem,reverse,DomainError

PASSWORD='A-local-test-password-938!'
TRANSLATIONS={'en':{'title':'Example','description':'Example description'},'es':{'title':'Ejemplo','description':'Descripción ejemplo'}}

class PilotTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        User=get_user_model();cls.admin=User.objects.create_user('admin',password=PASSWORD);StaffProfile.objects.create(user=cls.admin,role='admin')
        cls.org=Organization.objects.create(name='Loja A',kind='store',store_id='f0-loja-29')
        cls.other=Organization.objects.create(name='Loja B',kind='store',store_id='f1-loja-206')
        cls.partner=User.objects.create_user('partner',password=PASSWORD);StaffProfile.objects.create(user=cls.partner,role='partner',organization=cls.org)
        cls.cashier=User.objects.create_user('cashier',password=PASSWORD);StaffProfile.objects.create(user=cls.cashier,role='cashier',organization=cls.org)
        cls.member=Member.objects.create(first_name='Pessoa',last_name='Teste',phone='+5563999990000',status='active',age_18=True,balance=50)
        cls.now=timezone.now()
        cls.benefit=Benefit.objects.create(organization=cls.org,title='Benefício',description='Descrição',points_cost=10,stock=2,status='approved',starts=cls.now-timedelta(days=1),ends=cls.now+timedelta(days=10),translations=TRANSLATIONS)
        cls.event=Event.objects.create(organization=cls.org,title='Evento',description='Descrição',location='Praça A',starts=cls.now-timedelta(hours=1),ends=cls.now+timedelta(hours=1),status='approved',translations=TRANSLATIONS)
    def request(self,path,body=None,method='post',client=None):return getattr(client or self.client,method)('/api/v2/'+path,data=json.dumps(body or {}),content_type='application/json')
    def login(self,user=None):self.client.force_login(user or self.admin)
    def review(self,score=5,target_id='f0-loja-29',**extra):return {'target_type':'store','target_id':target_id,'score':score,'reason':'atendimento','phone':self.member.phone,'visited':True,'consent':True,**extra}
    def test_public_register_generic_pending_and_no_overwrite(self):
        data={'first_name':'Ana','last_name':'Teste','phone':'(63) 99999-1111','age_18':True,'consent':True}
        r=self.request('members/register',data);self.assertEqual(r.status_code,200);self.assertNotIn('member',r.json())
        m=Member.objects.get(phone='+5563999991111');self.assertEqual(m.status,'pending');self.assertFalse(m.phone_verified)
        data['first_name']='Outra';self.assertEqual(self.request('members/register',data).json(),r.json());m.refresh_from_db();self.assertEqual(m.first_name,'Ana')
    def test_underage_and_no_consent_rejected(self):
        for field in ('age_18','consent'):
            d={'first_name':'Ana','last_name':'Teste','phone':'63999991111','age_18':True,'consent':True};d[field]=False
            self.assertEqual(self.request('members/register',d).status_code,400)
    def test_activation_admin_only_and_unverified(self):
        self.member.status='pending';self.member.save();self.login(self.partner)
        self.assertEqual(self.request(f'members/{self.member.pk}/activate',{'confirmed_18':True}).status_code,403)
        self.login();self.assertEqual(self.request(f'members/{self.member.pk}/activate',{'confirmed_18':True}).status_code,200)
        self.member.refresh_from_db();self.assertEqual(self.member.status,'active');self.assertFalse(self.member.phone_verified)
    def test_csrf_enforced_including_login_and_public_registration(self):
        c=Client(enforce_csrf_checks=True)
        self.assertEqual(self.request('auth/login',{'username':'admin','password':PASSWORD},client=c).status_code,403)
        s=c.get('/api/v2/session').json();r=c.post('/api/v2/auth/login',data=json.dumps({'username':'admin','password':PASSWORD}),content_type='application/json',HTTP_X_CSRFTOKEN=s['csrf_token'])
        self.assertEqual(r.status_code,200);self.assertNotEqual(r.json()['csrf_token'],s['csrf_token']);self.assertEqual(r.json()['user']['role'],'admin')
    def test_login_rate_limit_persisted(self):
        # Fixed clock: the limiter uses 15-minute windows aligned to the epoch, so a real
        # clock crossing a boundary mid-test reset the counter and made this test flaky.
        start=1_800_000_000-(1_800_000_000%900)+10
        with mock.patch('core.services.time.time',return_value=start):
            for _ in range(10):self.assertEqual(self.request('auth/login',{'username':'bad','password':'bad'}).status_code,401)
            self.assertEqual(self.request('auth/login',{'username':'bad','password':'bad'}).status_code,429);self.assertTrue(RateBucket.objects.exists())
        with mock.patch('core.services.time.time',return_value=start+900):
            self.assertEqual(self.request('auth/login',{'username':'bad','password':'bad'}).status_code,401)
    def test_event_ids_cannot_bypass_once_only_reward(self):
        canonical=str(self.event.pk)
        data=self.review(target_type='event',target_id=canonical,reason='organizacao')
        self.assertEqual(self.request('reviews',data).status_code,200)
        for alias in ('0'+canonical,'00'+canonical):
            with self.subTest(alias=alias):
                self.assertEqual(self.request('reviews',{**data,'target_id':alias,'idempotency_key':alias}).status_code,400)
                self.assertEqual(self.client.get('/api/v2/public/ratings',{'target_type':'event','target_id':alias}).status_code,400)
        self.assertEqual(self.request('reviews',{**data,'idempotency_key':'second-attempt'}).status_code,200)
        self.member.refresh_from_db();self.assertEqual(self.member.balance,60)
        self.assertEqual(Ledger.objects.filter(target_type='event',target_id=canonical).count(),1)
        self.assertFalse(Review.objects.filter(target_type='event').exclude(target_id=canonical).exists())
        self.assertEqual(self.client.get('/api/v2/public/ratings',{'target_type':'event','target_id':canonical}).status_code,200)
    def test_event_ids_reject_noncanonical_or_out_of_range_values(self):
        for invalid in ('0','-1','1.0','١','²','9223372036854775808','9'*5000):
            with self.subTest(length=len(invalid)):
                self.assertEqual(self.request('reviews',self.review(target_type='event',target_id=invalid)).status_code,400)
        self.assertFalse(Review.objects.exists());self.assertFalse(Ledger.objects.exists())
    def test_pilot_admin_cannot_list_or_modify_superusers(self):
        root=get_user_model().objects.create_superuser('technical-root',password=PASSWORD)
        self.login()
        self.assertNotIn(root.pk,[item['id'] for item in self.client.get('/api/v2/staff').json()['items']])
        for changes in ({'password':'Replacement-Password-649!'}, {'active':False}):
            self.assertEqual(self.request(f'staff/{root.pk}',changes,'patch').status_code,403)
        root.refresh_from_db();self.assertTrue(root.is_active);self.assertTrue(root.check_password(PASSWORD))
        self.assertFalse(Audit.objects.filter(action='staff.save').exists())
        self.assertEqual(self.request(f'staff/{self.cashier.pk}',{'active':False},'patch').status_code,200)
    def test_superuser_can_manage_technical_accounts(self):
        root=get_user_model().objects.create_superuser('technical-root',password=PASSWORD)
        other=get_user_model().objects.create_superuser('other-root',password=PASSWORD)
        self.login(root)
        self.assertIn(other.pk,[item['id'] for item in self.client.get('/api/v2/staff').json()['items']])
        self.assertEqual(self.request(f'staff/{other.pk}',{'active':False},'patch').status_code,200)
        other.refresh_from_db();self.assertFalse(other.is_active)
    def test_suspended_organization_session_recovers_and_allows_csrf_login(self):
        c=Client(enforce_csrf_checks=True);c.force_login(self.cashier)
        old_session=c.session.session_key
        self.org.active=False;self.org.save()
        r=c.get('/api/v2/session');self.assertEqual(r.status_code,200)
        data=r.json();self.assertFalse(data['authenticated']);self.assertIsNone(data['user'])
        self.assertNotIn('_auth_user_id',c.session);self.assertNotEqual(old_session,c.session.session_key)
        r=c.post('/api/v2/auth/login',data=json.dumps({'username':'admin','password':PASSWORD}),content_type='application/json',HTTP_X_CSRFTOKEN=data['csrf_token'])
        self.assertEqual(r.status_code,200);self.assertEqual(r.json()['user']['id'],self.admin.pk)
        self.assertEqual(c.get('/api/v2/overview').status_code,200)
    def test_session_without_profile_is_logged_out(self):
        self.login(self.partner);StaffProfile.objects.filter(user=self.partner).delete()
        r=self.client.get('/api/v2/session');self.assertEqual(r.status_code,200)
        self.assertFalse(r.json()['authenticated']);self.assertIsNone(r.json()['user']);self.assertTrue(r.json()['csrf_token'])
        self.assertNotIn('_auth_user_id',self.client.session)
    def test_no_public_wallet_or_staff_endpoint_access(self):
        for url in ('members','overview','redemptions','staff','ratings'):
            self.assertEqual(self.client.get('/api/v2/'+url).status_code,401)
        self.assertEqual(self.request('members/lookup',{'phone':self.member.phone}).status_code,401)
    def test_partner_scope_and_cashier_permissions(self):
        other=Benefit.objects.create(organization=self.other,title='Outro',points_cost=10,stock=1)
        self.login(self.partner);items=self.client.get('/api/v2/benefits').json()['items'];self.assertEqual([i['id'] for i in items],[self.benefit.id])
        self.assertEqual(self.request('benefits/'+str(other.id),{'title':'Invadido'},'patch').status_code,404)
        self.assertEqual(self.client.get('/api/v2/members').status_code,403)
        self.login(self.cashier)
        for url in ('events','content','ratings'):self.assertEqual(self.client.get('/api/v2/'+url).status_code,403)
        self.assertEqual(self.client.get('/api/v2/benefits').status_code,200)
    def test_disabled_organization_revokes_access(self):
        self.login(self.partner);self.org.active=False;self.org.save();self.assertEqual(self.client.get('/api/v2/overview').status_code,403)
    def test_approval_translations_and_partner_edit_returns_pending(self):
        self.login(self.partner);r=self.request('benefits',{'title':'Novo','description':'Texto','points_cost':10,'stock':2});self.assertEqual(r.status_code,201);bid=r.json()['id']
        self.assertEqual(self.request(f'benefits/{bid}/approve').status_code,403)
        self.login();self.assertEqual(self.request(f'benefits/{bid}/approve').status_code,400)
        self.request(f'benefits/{bid}',{'translations':TRANSLATIONS,'starts':(self.now-timedelta(days=1)).isoformat(),'ends':(self.now+timedelta(days=1)).isoformat()},'patch')
        self.assertEqual(self.request(f'benefits/{bid}/approve').status_code,200)
        self.login(self.partner);self.assertEqual(self.request(f'benefits/{bid}',{'title':'Editado'},'patch').json()['status'],'pending')
    def test_event_approval_rechecks_conflict(self):
        a=Event.objects.create(organization=self.org,title='A',location='Praça Z',starts=self.now,ends=self.now+timedelta(hours=1),translations=TRANSLATIONS)
        b=Event.objects.create(organization=self.other,title='B',location='Praça Z',starts=self.now,ends=self.now+timedelta(hours=1),translations=TRANSLATIONS)
        self.login();self.assertEqual(self.request(f'events/{a.id}/approve').status_code,200);self.assertEqual(self.request(f'events/{b.id}/approve').status_code,409)
    def test_review_score_independent_ten_points(self):
        for score,tid in [(1,'f0-loja-29'),(5,'f1-loja-206')]:
            r=self.request('reviews',self.review(score,tid));self.assertEqual(r.status_code,200);self.assertNotIn('balance',r.json())
        self.member.refresh_from_db();self.assertEqual(self.member.balance,70);self.assertEqual(list(Ledger.objects.values_list('delta',flat=True)),[10,10])
    def test_review_requires_visited_and_valid_target(self):
        self.assertEqual(self.request('reviews',self.review(visited=False)).status_code,400)
        self.assertEqual(self.request('reviews',self.review(target_id='f0-wc-ca-f')).status_code,404)
        self.assertEqual(self.request('reviews',self.review(score=True)).status_code,400)
    def test_duplicate_store_and_event_once_survive_review_purge(self):
        self.request('reviews',self.review());self.request('reviews',self.review(idempotency_key='another'));self.assertEqual(Review.objects.count(),1)
        data={'target_type':'event','target_id':str(self.event.id),'score':2,'reason':'programacao','phone':self.member.phone,'consent':True,'visited':True}
        self.request('reviews',data);Review.objects.filter(target_type='event').delete()
        self.request('reviews',{**data,'idempotency_key':'new-key'});self.assertEqual(Ledger.objects.filter(target_type='event').count(),1)
    def test_daily_cap_thirty(self):
        for i in range(4):
            e=Event.objects.create(organization=self.org,title=str(i),location=str(i),starts=self.now,ends=self.now+timedelta(hours=1),status='approved')
            self.request('reviews',{'target_type':'event','target_id':str(e.id),'score':i+1,'reason':'programacao','phone':self.member.phone,'consent':True,'visited':True})
        self.member.refresh_from_db();self.assertEqual(self.member.balance,80);self.assertEqual(Review.objects.count(),4)
    def test_store_reward_after_thirty_days(self):
        self.request('reviews',self.review());Review.objects.update(created_at=self.now-timedelta(days=31));Ledger.objects.update(created_at=self.now-timedelta(days=31))
        self.request('reviews',self.review(idempotency_key='month-two'));self.assertEqual(Ledger.objects.count(),2)
    def test_pending_unknown_and_no_phone_get_same_generic_response(self):
        self.member.status='pending';self.member.save()
        a=self.request('reviews',self.review()).json();b=self.request('reviews',self.review(phone='+5563999998888',idempotency_key='b')).json();c=self.request('reviews',self.review(phone='',idempotency_key='c')).json()
        self.assertEqual(a,b);self.assertEqual(b,c);self.assertEqual(Ledger.objects.count(),0)
    def test_public_aggregate_threshold_and_scoped_partner(self):
        Review.objects.bulk_create([Review(target_type='store',target_id=self.org.store_id,score=4,reason='outro',organization=self.org) for _ in range(4)])
        url='/api/v2/public/ratings?target_type=store&target_id='+self.org.store_id
        self.assertIsNone(self.client.get(url).json()['items'][0]['count'])
        Review.objects.create(target_type='store',target_id=self.org.store_id,score=5,reason='outro',organization=self.org)
        r=self.client.get(url).json();self.assertEqual(r['items'][0]['count'],5);self.assertNotIn('phone',json.dumps(r));self.assertNotIn('member',json.dumps(r))
        Review.objects.create(target_type='store',target_id=self.other.store_id,score=1,reason='outro',organization=self.other)
        self.login(self.partner);self.assertEqual(len(self.client.get('/api/v2/ratings').json()['items']),1)
    def test_redemption_atomic_idempotent_and_reverse_once(self):
        self.login(self.cashier);data={'member_id':self.member.id,'benefit_id':self.benefit.id,'idempotency_key':'same'}
        r=self.request('redemptions',data);self.assertEqual(r.status_code,201);self.assertEqual(self.request('redemptions',data).status_code,200)
        self.member.refresh_from_db();self.benefit.refresh_from_db();self.assertEqual(self.member.balance,40);self.assertEqual(self.benefit.stock,1)
        self.assertEqual(self.request('redemptions/'+str(r.json()['id'])+'/reverse',{'reason':'Devolução'}).status_code,403)
        self.login();self.request(f"redemptions/{r.json()['id']}/reverse",{'reason':'Devolução'});self.request(f"redemptions/{r.json()['id']}/reverse",{'reason':'Repetida'})
        self.member.refresh_from_db();self.benefit.refresh_from_db();self.assertEqual(self.member.balance,50);self.assertEqual(self.benefit.stock,2);self.assertEqual(Ledger.objects.filter(kind='reversal').count(),1)
    def test_redemption_other_org_expiry_stock_balance_rejected(self):
        self.login(self.partner);b=Benefit.objects.create(organization=self.other,title='Outro',points_cost=10,stock=2,status='approved',starts=self.now-timedelta(days=1),ends=self.now+timedelta(days=1))
        self.assertEqual(self.request('redemptions',{'member_id':self.member.id,'benefit_id':b.id,'idempotency_key':'other'}).status_code,404)
        for field,value in [('stock',0),('ends',self.now-timedelta(days=1)),('points_cost',999)]:
            self.benefit.stock=2;self.benefit.ends=self.now+timedelta(days=1);self.benefit.points_cost=10;setattr(self.benefit,field,value);self.benefit.save()
            self.assertEqual(self.request('redemptions',{'member_id':self.member.id,'benefit_id':self.benefit.id,'idempotency_key':field}).status_code,409)
        self.assertEqual(Redemption.objects.count(),0)
    def test_idempotency_payload_conflict(self):
        self.login();data={'member_id':self.member.id,'benefit_id':self.benefit.id,'idempotency_key':'same'};self.request('redemptions',data)
        self.assertEqual(self.request('redemptions',{**data,'member_id':999}).status_code,409)
    def test_close_forfeit_and_retention_without_breaking_ledger(self):
        self.login();r=self.request(f'members/{self.member.id}/close',{'reason':'Pedido do titular'});self.assertEqual(r.status_code,409)
        self.assertEqual(self.request(f'members/{self.member.id}/close',{'reason':'Pedido do titular','forfeit_balance':True}).status_code,200)
        self.member.refresh_from_db();self.assertIsNone(self.member.phone);self.assertEqual(self.member.balance,0);self.assertEqual(Ledger.objects.get(kind='closure').delta,-50)
        Member.objects.filter(pk=self.member.pk).update(closed_at=self.now-timedelta(days=181));call_command('purge_pilot',verbosity=0);self.assertFalse(Member.objects.filter(pk=self.member.pk).exists())
    def test_export_admin_only(self):
        self.login(self.partner);self.assertEqual(self.client.get(f'/api/v2/members/{self.member.id}/export').status_code,403)
        self.login();self.assertEqual(self.client.get(f'/api/v2/members/{self.member.id}/export').json()['member']['phone'],self.member.phone)
    def test_content_upload_and_translations_validation(self):
        self.login();r=self.request('content',{'organization_id':self.org.id,'title':'Anúncio','kind':'ad','starts':self.now.isoformat(),'ends':(self.now+timedelta(days=1)).isoformat(),'image_data':'data:image/svg+xml;base64,PHN2Zz4='});self.assertEqual(r.status_code,400)
        r=self.request('content',{'organization_id':self.org.id,'title':'Anúncio','kind':'ad','starts':self.now.isoformat(),'ends':(self.now+timedelta(days=1)).isoformat(),'target_url':'javascript:alert(1)'});self.assertEqual(r.status_code,400)
    def test_capacity_limits(self):
        Member.objects.bulk_create([Member(first_name='A',last_name='B',phone=f'+55639999{i:05}',age_18=True) for i in range(99)])
        self.request('members/register',{'first_name':'A','last_name':'B','phone':'63999991111','age_18':True,'consent':True});self.assertEqual(Member.objects.count(),100)
        self.login()
        for i in range(3):self.assertEqual(self.request('organizations',{'name':str(i),'kind':'producer'}).status_code,201)
        self.assertEqual(self.request('organizations',{'name':'Sixth','kind':'producer'}).status_code,409)
    def test_navigation_and_sensitive_static_files(self):
        r=self.client.get('/api/navigation');self.assertEqual(r.status_code,200);self.assertIn('stores',r.json())
        self.assertEqual(self.client.get('/server.py').status_code,404);self.assertEqual(self.client.get('/data/pilot.sqlite3').status_code,404)
        self.assertEqual(self.client.get('/explorar.html').status_code,200)
    def test_public_catalog_no_pending_or_identity(self):
        Benefit.objects.create(organization=self.org,title='Pendente',points_cost=1,stock=4)
        result=self.client.get('/api/v2/public/catalog').json();self.assertEqual(len(result['benefits']),1);self.assertNotIn('phone',json.dumps(result));self.assertTrue(result['stores'])
    def test_cashier_lookup_is_masked_audited(self):
        self.login(self.cashier);r=self.request('members/lookup',{'phone':self.member.phone}).json()['member'];self.assertNotIn('phone',r);self.assertEqual(r['phone_masked'],'***0000');self.assertTrue(Audit.objects.filter(action='member.lookup').exists())
    def test_closed_is_terminal_and_repeated_close_preserves_retention(self):
        self.login();data={'reason':'Pedido','forfeit_balance':True};self.request(f'members/{self.member.id}/close',data)
        self.member.refresh_from_db();closed=self.member.closed_at
        self.assertEqual(self.request(f'members/{self.member.id}/suspend').status_code,409)
        self.assertEqual(self.request(f'members/{self.member.id}/activate',{'confirmed_18':True}).status_code,400)
        self.request(f'members/{self.member.id}/close',data);self.member.refresh_from_db();self.assertEqual(self.member.closed_at,closed)
    def test_event_review_window_and_unrelated_identity_fields(self):
        data={'target_type':'event','target_id':str(self.event.id),'score':5,'reason':'outro','visited':True,'consent':True}
        self.event.starts=self.now+timedelta(days=1);self.event.ends=self.now+timedelta(days=2);self.event.save()
        self.assertEqual(self.request('reviews',data).status_code,409)
        self.event.starts=self.now-timedelta(days=32);self.event.ends=self.now-timedelta(days=31);self.event.save()
        self.assertEqual(self.request('reviews',data).status_code,409)
        self.assertEqual(self.request('reviews',{**self.review(),'email':'not-allowed@example.test'}).status_code,400)
    def test_anonymous_review_double_click_deduplicated(self):
        self.request('reviews',self.review(phone=''));self.request('reviews',self.review(phone=''));self.assertEqual(Review.objects.count(),1)
    def test_org_unique_store_id(self):
        self.login();self.assertEqual(self.request('organizations',{'name':'Duplicada','kind':'store','store_id':self.org.store_id}).status_code,400)
    def test_ledger_survives_review_retention_and_pending_expires(self):
        self.request('reviews',self.review());Review.objects.update(created_at=self.now-timedelta(days=31))
        pending=Member.objects.create(first_name='A',last_name='B',phone='+5563999988888',age_18=True);Member.objects.filter(pk=pending.pk).update(created_at=self.now-timedelta(days=31))
        call_command('purge_pilot',verbosity=0);self.assertEqual(Review.objects.count(),0);self.assertEqual(Ledger.objects.count(),1);self.assertFalse(Member.objects.filter(pk=pending.pk).exists())
    @override_settings(PILOT_OPERATIONS_ENABLED=False)
    def test_operations_pause_preserves_read_and_anonymous_feedback(self):
        self.assertEqual(self.request('members/register',{'first_name':'A','last_name':'B','phone':'63999991111','age_18':True,'consent':True}).status_code,503)
        self.assertEqual(self.request('reviews',self.review()).status_code,503)
        self.assertEqual(self.request('reviews',self.review(phone='')).status_code,200)
        self.login();self.assertEqual(self.request('redemptions',{'member_id':self.member.id,'benefit_id':self.benefit.id,'idempotency_key':'pause'}).status_code,503)
        self.assertEqual(self.client.get(f'/api/v2/members/{self.member.id}/export').status_code,200)
        self.assertEqual(self.client.get('/api/v2/public/catalog').status_code,200)

@skipUnless(connection.vendor=='postgresql','Concorrência exige PostgreSQL; SQLite local não valida locks de linha.')
class PostgresConcurrencyTests(TransactionTestCase):
    def test_two_cashiers_cannot_oversell_last_item(self):
        User=get_user_model();actor=User.objects.create_user('actor');org=Organization.objects.create(name='Loja',kind='store')
        now=timezone.now();benefit=Benefit.objects.create(organization=org,title='Último',points_cost=10,stock=1,status='approved',starts=now-timedelta(days=1),ends=now+timedelta(days=1))
        members=[Member.objects.create(first_name='A',last_name='B',phone=f'+556399999000{i}',age_18=True,status='active',balance=10) for i in range(2)]
        def worker(i):
            try:
                redeem(User.objects.get(pk=actor.pk),'admin',None,{'member_id':members[i].id,'benefit_id':benefit.id,'idempotency_key':str(i)});return True
            except DomainError:return False
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(worker,range(2)))
        self.assertEqual(sum(results),1);benefit.refresh_from_db();self.assertEqual(benefit.stock,0);self.assertEqual(Redemption.objects.count(),1);self.assertEqual(sum(Member.objects.values_list('balance',flat=True)),10)
    def test_concurrent_event_approvals_only_one_published(self):
        User=get_user_model();actor=User.objects.create_user('admin');StaffProfile.objects.create(user=actor,role='admin');org=Organization.objects.create(name='Loja',kind='store');now=timezone.now()
        events=[Event.objects.create(organization=org,title=str(i),location='Praça',starts=now,ends=now+timedelta(hours=1),translations=TRANSLATIONS) for i in range(2)]
        def worker(i):
            try:
                c=Client();c.force_login(User.objects.get(pk=actor.pk));return c.post(f'/api/v2/events/{events[i].id}/approve',data='{}',content_type='application/json').status_code
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(worker,range(2)))
        self.assertEqual(sorted(results),[200,409]);self.assertEqual(Event.objects.filter(status='approved').count(),1)
    def test_edit_and_redemption_do_not_restore_stock(self):
        User=get_user_model();actor=User.objects.create_user('admin');StaffProfile.objects.create(user=actor,role='admin');org=Organization.objects.create(name='Loja',kind='store');now=timezone.now()
        benefit=Benefit.objects.create(organization=org,title='Item',points_cost=10,stock=1,status='approved',starts=now-timedelta(days=1),ends=now+timedelta(days=1))
        member=Member.objects.create(first_name='A',last_name='B',phone='+5563999991111',age_18=True,status='active',balance=10)
        def worker(i):
            try:
                if i==0:
                    c=Client();c.force_login(User.objects.get(pk=actor.pk));return c.patch(f'/api/v2/benefits/{benefit.id}',data=json.dumps({'title':'Novo título'}),content_type='application/json').status_code
                try:redeem(User.objects.get(pk=actor.pk),'admin',None,{'member_id':member.id,'benefit_id':benefit.id,'idempotency_key':'redeem'});return 201
                except DomainError as e:return e.status
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(worker,range(2)))
        self.assertEqual(results[0],200);self.assertIn(results[1],(201,409));benefit.refresh_from_db();self.assertEqual(benefit.stock+Redemption.objects.count(),1)
    def test_simultaneous_enrollments_respect_capacity(self):
        from .services import register
        Member.objects.bulk_create([Member(first_name='A',last_name='B',phone=f'+55639999{i:05}',age_18=True) for i in range(99)])
        def worker(i):
            try:register({'first_name':'A','last_name':'B','phone':f'+556388888000{i}','age_18':True,'consent':True})
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(worker,range(2)))
        self.assertEqual(Member.objects.count(),100)
