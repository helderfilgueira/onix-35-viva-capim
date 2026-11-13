import copy
import http.client
import json
import threading
import unittest
from pathlib import Path

from navigation import NavigationError, calculate_route, load_navigation, validate_graph
from server import AppServer, Store


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((Path(__file__).parent/'tests'/'demo-graph.json').read_text(encoding='utf-8'))

    def route(self, start='f0-c0', end='loja-07-entrada', accessible=False, data=None):
        return calculate_route({'origin': start, 'destination': end, 'accessible': accessible,
                                'map_version': self.data['version']}, data or self.data)

    def test_accessible_route_uses_elevator_not_stairs(self):
        normal = self.route()
        accessible = self.route(accessible=True)
        self.assertIn('stairs', [s['kind'] for s in normal['segments']])
        self.assertNotIn('stairs', [s['kind'] for s in accessible['segments']])
        self.assertIn('elevator', [s['kind'] for s in accessible['segments']])
        self.assertGreater(accessible['distance'], normal['distance'])

    def test_blocked_elevator_has_no_accessible_route(self):
        for edge in self.data['edges']:
            if edge['kind'] == 'elevator':
                edge['blocked'] = True
        with self.assertRaises(NavigationError) as error:
            self.route(accessible=True)
        self.assertEqual(error.exception.status, 422)
        self.assertIn('stairs', [s['kind'] for s in self.route()['segments']])

    def test_route_every_anchor_to_every_store_uses_only_edges(self):
        edges = {(e['from'], e['to']) for e in self.data['edges']}
        edges |= {(b, a) for a, b in edges}
        for anchor in self.data['anchors']:
            for store in self.data['stores']:
                for accessible in (False, True):
                    result = self.route(anchor['node_id'], store['node_id'], accessible)
                    ids = [n['id'] for n in result['path']]
                    self.assertEqual(ids[0], anchor['node_id'])
                    self.assertEqual(ids[-1], store['node_id'])
                    self.assertTrue(all((a,b) in edges for a,b in zip(ids, ids[1:])))
                    # Horizontal segments remain in corridor or terminate at an entrance.
                    for a,b in zip(result['path'], result['path'][1:]):
                        if a['floor_id'] == b['floor_id']:
                            self.assertTrue((a['z'] == b['z'] == 0) or (a['x'] == b['x'] and max(abs(a['z']),abs(b['z'])) <= 5))

    def test_one_way_and_disconnected(self):
        data = copy.deepcopy(self.data)
        data['edges'] = [dict(e, bidirectional=False) for e in data['edges']]
        with self.assertRaises(NavigationError):
            self.route('loja-01-entrada', 'f0-c2', data=data)

    def test_same_origin_and_unknown_node(self):
        result = self.route('f0-c2', 'f0-c2')
        self.assertEqual(result['distance'], 0)
        self.assertEqual(len(result['path']), 1)
        with self.assertRaises(NavigationError) as error:
            self.route('bad', 'f0-c2')
        self.assertEqual(error.exception.status, 404)

    def test_invalid_types_fields_and_stale_version(self):
        base = {'origin':'f0-c0','destination':'f1-c0','accessible':True,'map_version':self.data['version']}
        for invalid in (dict(base, accessible=1),dict(base, origin=[]),dict(base, email='x'),{}):
            with self.assertRaises(NavigationError) as error:
                calculate_route(invalid, self.data)
            self.assertEqual(error.exception.status,400)
        with self.assertRaises(NavigationError) as error:
            calculate_route(dict(base,map_version='old'),self.data)
        self.assertEqual(error.exception.status,409)

    def test_invalid_graph_rejected(self):
        for key,value in [('distance',-1),('distance',float('nan')),('to','missing')]:
            data = copy.deepcopy(self.data)
            data['edges'][0][key]=value
            with self.assertRaises(ValueError):
                validate_graph(data)

    def test_referential_integrity_and_geometry(self):
        alterations = [
            ('anchors',0,'node_id','missing'), ('nodes',0,'floor_id','missing'),
            ('nodes',0,'y',100), ('stores',0,'node_id','f0-c2'),
            ('stores',0,'floor_id','f1'), ('stores',0,'width',-1),
            ('edges',0,'kind','teleport'), ('edges',0,'blocked','false'),
            ('edges',0,'bidirectional',1), ('edges',0,'distance',1),
        ]
        for collection,index,key,value in alterations:
            with self.subTest(collection=collection,key=key,value=value):
                data=copy.deepcopy(self.data)
                data[collection][index][key]=value
                with self.assertRaises(ValueError):
                    validate_graph(data)

    def test_distance_sum_and_determinism(self):
        first=self.route()
        self.assertAlmostEqual(first['distance'],sum(s['distance'] for s in first['segments']))
        for _ in range(10):
            self.assertEqual(self.route()['path'],first['path'])

    def test_empty_version_is_invalid_and_string_boolean_rejected(self):
        self.data['version']=''
        with self.assertRaises(ValueError):
            validate_graph(self.data)
        self.setUp()
        with self.assertRaises(NavigationError) as error:
            self.route(accessible='false')
        self.assertEqual(error.exception.status,400)


class NavigationHTTPTests(unittest.TestCase):
    def setUp(self):
        self.store=Store(':memory:')
        self.server=AppServer(('127.0.0.1',0), self.store,'testing-admin-only')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.store.db.close()

    def req(self,path,body=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        conn.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),{'Content-Type':'application/json'})
        response=conn.getresponse(); raw=response.read(); status=response.status; conn.close()
        return status,json.loads(raw)

    def test_public_catalog_and_route_need_no_session(self):
        status,data=self.req('/api/navigation')
        self.assertEqual(status,200); self.assertGreater(len(data['stores']),12)
        target=next(s for s in data['stores'] if s['name']=='Renner')
        status,route=self.req('/api/routes',{'origin':data['anchors'][0]['node_id'],'destination':target['node_id'],'accessible':True,'map_version':data['version']})
        self.assertEqual(status,200); self.assertTrue(route['demo'])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM sessions').fetchone()[0],0)

    def test_http_rejects_bad_payload_and_private_files(self):
        self.assertEqual(self.req('/api/routes',{'origin':[]})[0],400)
        for path in ('/navigation.py','/navigation-data.json','/vendor/../server.py'):
            self.assertEqual(self.req(path)[0],404)


if __name__=='__main__':
    unittest.main()
