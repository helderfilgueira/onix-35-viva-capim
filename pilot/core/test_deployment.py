import importlib, os, runpy
from datetime import timedelta
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction, DatabaseError
from django.test import SimpleTestCase,TestCase,TransactionTestCase,override_settings
from django.utils import timezone
from .models import Member

CRON_TEST_SECRET='cron-test-only-'+('a'*40)

class PoolSettingsTests(SimpleTestCase):
    def test_postgres_settings_disable_session_bound_features(self):
        env={'DATABASE_URL':'postgresql://pilot:password@pooler.example.test:6543/postgres','DJANGO_DEBUG':'0','DJANGO_SECRET_KEY':'test-only-secret-not-real','DJANGO_ALLOWED_HOSTS':'pilot.example.test','DB_SSLMODE':'require'}
        with patch.dict(os.environ,env):
            result=runpy.run_path(str(Path(settings.BASE_DIR)/'config'/'settings.py'))
        database=result['DATABASES']['default']
        self.assertEqual(database['CONN_MAX_AGE'],0)
        self.assertTrue(database['DISABLE_SERVER_SIDE_CURSORS'])
        self.assertIsNone(database['OPTIONS']['prepare_threshold'])
        self.assertEqual(result['ALLOWED_HOSTS'],['pilot.example.test'])

@override_settings(CRON_SECRET=CRON_TEST_SECRET)
class MaintenanceTests(TestCase):
    def setUp(self):
        self.member=Member.objects.create(first_name='Expired',last_name='Pending',phone='+5563999990001',age_18=True)
        Member.objects.filter(pk=self.member.pk).update(created_at=timezone.now()-timedelta(days=31))
    def test_missing_wrong_and_query_secret_do_not_run_cleanup(self):
        for url,header in [('/api/v2/maintenance',''),('/api/v2/maintenance','Bearer wrong'),('/api/v2/maintenance?secret='+CRON_TEST_SECRET,'')]:
            self.assertEqual(self.client.get(url,HTTP_AUTHORIZATION=header).status_code,401)
        self.assertTrue(Member.objects.filter(pk=self.member.pk).exists())
    def test_dashboard_login_does_not_authorize_maintenance(self):
        user=get_user_model().objects.create_superuser(username='maintenance-admin',password='Test-only-password-472!')
        self.client.force_login(user)
        self.assertEqual(self.client.get('/api/v2/maintenance').status_code,401)
        self.assertTrue(Member.objects.filter(pk=self.member.pk).exists())
    def test_valid_bearer_runs_purge_and_repetition_is_safe(self):
        for _ in range(2):
            result=self.client.get('/api/v2/maintenance',HTTP_AUTHORIZATION='Bearer '+CRON_TEST_SECRET)
            self.assertEqual(result.status_code,200);self.assertEqual(result.json(),{'ok':True})
        self.assertFalse(Member.objects.filter(pk=self.member.pk).exists())
    @override_settings(CRON_SECRET='')
    def test_unconfigured_secret_fails_closed(self):
        self.assertEqual(self.client.get('/api/v2/maintenance',HTTP_AUTHORIZATION='Bearer ').status_code,503)
        self.assertTrue(Member.objects.filter(pk=self.member.pk).exists())
    def test_maintenance_only_accepts_cron_get(self):
        result=self.client.post('/api/v2/maintenance',data='{}',content_type='application/json',HTTP_AUTHORIZATION='Bearer '+CRON_TEST_SECRET)
        self.assertEqual(result.status_code,405)
        self.assertTrue(Member.objects.filter(pk=self.member.pk).exists())

@skipUnless(connection.vendor=='postgresql','RLS/grants require PostgreSQL, not the SQLite demonstration.')
class SupabaseTableProtectionTests(TransactionTestCase):
    def setUp(self):
        self.created_roles=[]
        with connection.cursor() as cursor:
            for name in ('anon','authenticated'):
                cursor.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',[name])
                if not cursor.fetchone():
                    cursor.execute(f'CREATE ROLE {connection.ops.quote_name(name)} NOLOGIN')
                    self.created_roles.append(name)
            cursor.execute('CREATE TABLE public.pilot_rls_unrelated_probe (id integer)')
            cursor.execute('GRANT SELECT ON public.pilot_rls_unrelated_probe TO anon')
            cursor.execute('CREATE SCHEMA pilot_rls_probe_schema')
            cursor.execute('CREATE TABLE pilot_rls_probe_schema.core_member (id integer)')
            cursor.execute('GRANT SELECT ON public.core_member TO anon, authenticated, PUBLIC')
        migration=importlib.import_module('core.migrations.0003_protect_public_tables')
        with connection.schema_editor() as editor:migration.protect_public_tables(apps,editor)
    def tearDown(self):
        with connection.cursor() as cursor:
            cursor.execute('DROP TABLE public.pilot_rls_unrelated_probe')
            cursor.execute('DROP SCHEMA pilot_rls_probe_schema CASCADE')
            for role in self.created_roles:cursor.execute(f'DROP ROLE {connection.ops.quote_name(role)}')
        super().tearDown()
    def test_only_owned_app_tables_in_public_are_protected(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('core_member','auth_user','django_session','django_migrations','pilot_rls_unrelated_probe')")
            rows=dict(cursor.fetchall())
            for name in ('core_member','auth_user','django_session','django_migrations'):self.assertTrue(rows[name],name)
            self.assertFalse(rows['pilot_rls_unrelated_probe'])
            cursor.execute("SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pilot_rls_probe_schema' AND c.relname='core_member'")
            self.assertFalse(cursor.fetchone()[0])
            cursor.execute("SELECT has_table_privilege('anon','public.pilot_rls_unrelated_probe','SELECT')")
            self.assertTrue(cursor.fetchone()[0])
    def test_anon_authenticated_cannot_read_member_but_owner_can_write(self):
        member=Member.objects.create(first_name='Private',last_name='Name',phone='+5563999991234',age_18=True)
        self.assertTrue(Member.objects.filter(pk=member.pk).exists())
        for role in ('anon','authenticated'):
            with connection.cursor() as cursor:
                cursor.execute('SELECT has_table_privilege(%s,%s,%s)',[role,'public.core_member','SELECT'])
                self.assertFalse(cursor.fetchone()[0])
            with self.assertRaises(DatabaseError):
                with transaction.atomic():
                    with connection.cursor() as cursor:
                        cursor.execute(f'SET LOCAL ROLE {connection.ops.quote_name(role)}')
                        cursor.execute('SELECT first_name,phone FROM public.core_member')
