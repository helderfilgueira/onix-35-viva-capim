import hashlib
import http.client
import json
import threading
import time
import unittest
from server import AppServer, Store, RETENTION


class StoreReviewTests(unittest.TestCase):
    STORE = 'f0-loja-29'

    def setUp(self):
        self.store = Store(':memory:')
        self.server = AppServer(('127.0.0.1', 0), self.store, 'test-administrator-secret')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.store.db.close()

    def req(self, path, method='GET', data=None, token='', headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=10)
        request_headers = {'Content-Type': 'application/json'}
        if token:
            request_headers['X-Session-Token'] = token
        request_headers.update(headers or {})
        conn.request(method, path, json.dumps(data) if data is not None else None, request_headers)
        response = conn.getresponse()
        code, raw = response.status, response.read()
        conn.close()
        return code, json.loads(raw)

    def session(self, notice='store-review-v1'):
        status, result = self.req('/api/session', 'POST', {'consent': True, 'notice': notice})
        self.assertEqual(status, 201)
        self.assertEqual(result['notice'], notice)
        return result['token']

    def checkin(self, token, store_id=STORE):
        return self.req('/api/store-checkins', 'POST', {'store_id': store_id, 'visited': True}, token)

    def review(self, token, score=5, store_id=STORE, reason='atendimento'):
        return self.req('/api/store-reviews', 'POST', {'store_id': store_id, 'score': score, 'reason': reason}, token)

    def rate(self, score=5):
        token = self.session()
        self.assertEqual(self.checkin(token)[0], 201)
        self.assertEqual(self.review(token, score)[0], 201)
        return token

    def ratings(self):
        status, data = self.req('/api/store-ratings?store_id=' + self.STORE)
        self.assertEqual(status, 200)
        return data

    def test_public_aggregate_does_not_require_consent_or_expose_raw_data(self):
        data = self.ratings()
        self.assertIsNone(data['average'])
        self.assertIsNone(data['count'])
        self.assertEqual(data['status'], 'amostra_insuficiente')
        self.assertEqual(data['source'], 'local_demo')
        for key in ('token', 'receipt', 'session_id', 'reviews', 'created', 'id'):
            self.assertNotIn(key, data)
        self.assertEqual(self.req('/api/store-reviews')[0], 404)

    def test_consent_is_explicit_and_separate_from_events(self):
        for value in (False, 1, 'true', None):
            self.assertEqual(self.req('/api/session', 'POST', {'consent': value, 'notice': 'store-review-v1'})[0], 400)
        events_token = self.session('demo-v1')
        self.assertEqual(self.checkin(events_token)[0], 403)
        for value in (False, 1, 'true', None):
            self.assertEqual(self.req('/api/store-consent', 'POST', {'consent': value, 'notice': 'store-review-v1'}, events_token)[0], 400)
        self.assertEqual(self.req('/api/store-consent', 'POST', {'consent': True, 'notice': 'store-review-v1'}, events_token)[0], 200)
        self.assertEqual(self.checkin(events_token)[0], 201)
        # Store consent is not a replacement for event consent.
        store_token = self.session()
        self.assertEqual(self.req('/api/checkins', 'POST', {'event_id': 'musica'}, store_token)[0], 403)
        self.assertEqual(self.req('/api/checkins', 'POST', {'event_id': 'musica'}, events_token)[0], 201)

    def test_requires_explicit_self_reported_visit(self):
        token = self.session()
        self.assertEqual(self.review(token)[0], 409)
        for value in (False, 1, 'true', None):
            self.assertEqual(self.req('/api/store-checkins', 'POST', {'store_id': self.STORE, 'visited': value}, token)[0], 400)
        status, data = self.checkin(token)
        self.assertEqual(status, 201)
        self.assertTrue(data['self_reported'])

    def test_score_reason_and_extra_fields_are_validated(self):
        token = self.session()
        self.checkin(token)
        for value in (True, False, 0, 6, 2.5, '5', None, [], {}):
            self.assertEqual(self.review(token, value)[0], 400)
        for reason in ('programacao', 'my free text', None, [], {}):
            self.assertEqual(self.review(token, reason=reason)[0], 400)
        for extra in ('email', 'cpf', 'comment', 'latitude'):
            body = {'store_id': self.STORE, 'score': 5, 'reason': 'outro', extra: 'not-accepted'}
            self.assertEqual(self.req('/api/store-reviews', 'POST', body, token)[0], 400)
        self.assertEqual(self.review(token)[0], 201)

    def test_catalog_validation_rejects_unknown_and_facility_targets(self):
        token = self.session()
        for bad in ('missing', "'; DROP TABLE sessions;--", 'f0-wc-ca-f', 'f0-unidentified-south-island', None, 29):
            self.assertEqual(self.checkin(token, bad)[0], 404)
            self.assertEqual(self.review(token, store_id=bad)[0], 404)
        self.assertEqual(self.req('/api/store-ratings?store_id=f0-wc-ca-f')[0], 404)
        for query in ('', '?store_id=', '?store_id=x&store_id=y', '?store_id=x&profile=all'):
            self.assertIn(self.req('/api/store-ratings' + query)[0], (400, 404))

    def test_duplicate_isolation_export_and_delete(self):
        token = self.rate(4)
        other = self.session()
        self.assertEqual(self.checkin(token)[0], 409)
        self.assertEqual(self.review(token)[0], 409)
        records = self.req('/api/me', token=token)[1]
        self.assertEqual(records['notice'], 'store-review-v1')
        self.assertEqual(len(records['store_reviews']), 1)
        self.assertEqual(records['store_reviews'][0]['score'], 4)
        self.assertEqual(len(records['store_checkins']), 1)
        self.assertEqual(len(records['store_consents']), 1)
        self.assertEqual(records['reviews'], [])
        self.assertEqual(self.req('/api/me', token=other)[1]['store_reviews'], [])
        self.assertTrue(self.req('/api/me', 'DELETE', token=token)[1]['deleted'])
        for table in ('store_reviews', 'store_checkins', 'store_consents'):
            # Other session's consent remains, but no data from the deleted session survives.
            sid = hashlib.sha256(token.encode()).hexdigest()
            self.assertEqual(self.store.db.execute(f'SELECT count(*) FROM {table} WHERE session_id=?', (sid,)).fetchone()[0], 0)
        self.assertEqual(self.req('/api/me', token=token)[0], 401)

    def test_aggregate_threshold_and_deletion_recalculate(self):
        tokens = [self.rate(score) for score in (1, 2, 3, 4)]
        self.assertIsNone(self.ratings()['average'])
        self.assertIsNone(self.ratings()['count'])
        tokens.append(self.rate(5))
        data = self.ratings()
        self.assertEqual(data['average'], 3)
        self.assertEqual(data['count'], 5)
        self.req('/api/me', 'DELETE', token=tokens[0])
        self.assertIsNone(self.ratings()['average'])
        self.assertIsNone(self.ratings()['count'])

    def test_expired_tokens_keep_rights_but_cannot_submit(self):
        token = self.rate()
        with self.store.db:
            self.store.db.execute('UPDATE sessions SET expires=?', (time.time() - 1,))
        self.assertEqual(self.checkin(token, 'f0-loja-32')[0], 401)
        self.assertEqual(self.review(token)[0], 401)
        self.assertEqual(self.req('/api/store-consent', 'POST', {'consent': True, 'notice': 'store-review-v1'}, token)[0], 401)
        self.assertEqual(len(self.req('/api/me', token=token)[1]['store_reviews']), 1)
        self.assertEqual(self.req('/api/me', 'DELETE', token=token)[0], 200)

    def test_retention_cascades_to_all_store_records(self):
        token = self.rate()
        with self.store.db:
            self.store.db.execute('UPDATE sessions SET created=?', (time.time() - RETENTION - 1,))
        self.ratings()  # Cleanup also runs before public reads.
        for table in ('sessions', 'store_consents', 'store_checkins', 'store_reviews'):
            self.assertEqual(self.store.db.execute(f'SELECT count(*) FROM {table}').fetchone()[0], 0)
        self.assertEqual(self.req('/api/me', token=token)[0], 401)

    def test_host_origin_and_auth_guards_apply_to_store_endpoints(self):
        self.assertEqual(self.checkin('A' * 43)[0], 401)
        token = self.session()
        payload = {'store_id': self.STORE, 'score': 5, 'reason': 'atendimento'}
        self.assertEqual(self.req('/api/store-reviews', 'POST', payload, token, {'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(self.req('/api/store-ratings?store_id=' + self.STORE, headers={'Host': 'other.example'})[0], 403)
        self.assertEqual(self.req('/api/store-checkins', 'POST', {'store_id': self.STORE, 'visited': True, 'email': 'x'}, token)[0], 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
