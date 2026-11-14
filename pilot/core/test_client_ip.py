import os
from unittest.mock import patch
from django.test import RequestFactory, SimpleTestCase, TestCase
from .services import client_ip, rate_limit, DomainError
from .models import RateBucket


class ClientIPTests(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()

    @patch.dict(os.environ, {'VERCEL':'1'})
    def test_vercel_valid_ipv4_and_ipv6(self):
        for forwarded,expected in [('192.0.2.5','192.0.2.5'),('2001:db8:0:0::1','2001:db8::1')]:
            request=self.factory.get('/',REMOTE_ADDR='127.0.0.1',HTTP_X_FORWARDED_FOR=forwarded)
            self.assertEqual(client_ip(request),expected)

    @patch.dict(os.environ, {'VERCEL':'0'})
    def test_other_hosts_never_trust_header(self):
        request=self.factory.get('/',REMOTE_ADDR='192.0.2.6',HTTP_X_FORWARDED_FOR='192.0.2.5')
        self.assertEqual(client_ip(request),'192.0.2.6')

    @patch.dict(os.environ, {'VERCEL':'1'})
    def test_invalid_missing_chain_or_scope_fall_back_to_peer(self):
        for forwarded in ['', 'garbage', '192.0.2.5, 192.0.2.6', '192.0.2.5:80', 'fe80::1%eth0']:
            request=self.factory.get('/',REMOTE_ADDR='127.0.0.1',HTTP_X_FORWARDED_FOR=forwarded)
            self.assertEqual(client_ip(request),'127.0.0.1')


class RateLimitClientIPTests(TestCase):
    @patch.dict(os.environ, {'VERCEL':'1'})
    def test_distinct_clients_do_not_share_bucket_and_no_raw_ip_is_stored(self):
        factory=RequestFactory()
        first=factory.get('/',REMOTE_ADDR='127.0.0.1',HTTP_X_FORWARDED_FOR='192.0.2.5')
        second=factory.get('/',REMOTE_ADDR='127.0.0.1',HTTP_X_FORWARDED_FOR='192.0.2.6')
        rate_limit(first,'test',1,3600)
        rate_limit(second,'test',1,3600)
        with self.assertRaises(DomainError) as raised:rate_limit(first,'test',1,3600)
        self.assertEqual(raised.exception.status,429)
        keys=list(RateBucket.objects.values_list('key',flat=True))
        self.assertEqual(len(keys),2)
        self.assertTrue(all(len(key)==64 and '.' not in key for key in keys))
