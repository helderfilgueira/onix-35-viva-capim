import unittest,copy
from navigation import load_navigation,calculate_route,validate_graph,NavigationError
from plan_geometry import crosses_interior

class PlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=load_navigation()
    def route(self,origin,name):
        s=next(s for s in self.data['stores'] if s['name']==name)
        return calculate_route({'origin':origin,'destination':s['node_id'],'accessible':True,'map_version':self.data['version']},self.data)
    def test_source_and_positions(self):
        self.assertEqual(self.data['geometry_source'],'pdf-vector')
        self.assertGreaterEqual(len(self.data['stores']),210)
        names={s['name']:s for s in self.data['stores']}
        self.assertLess(names['Renner']['x'],names['Riachuelo']['x'])
        self.assertLess(names['Riachuelo']['x'],names['Cinemark']['x'])
        self.assertLess(names['C&A']['z'],names['Riachuelo']['z'])
        self.assertLess(names['Riachuelo']['z'],names['Marisa']['z'])
        self.assertTrue(all(s['source_page'] in (1,2,3) for s in self.data['stores']))
    def test_all_audited_kiosks_and_insets_are_present(self):
        kiosks=[s for s in self.data['stores'] if s.get('unit_type')=='kiosk' and s['floor_id']=='f0']
        self.assertEqual(len(kiosks),50)
        self.assertEqual(sum(bool(s['polygon']) for s in kiosks),49)
        q30=[s for s in kiosks if s['source_label']=='Q 30']
        self.assertEqual(len(q30),2)
        self.assertEqual(len({s['id'] for s in q30}),2)
        names={s['name'] for s in self.data['stores'] if s['source_page']==1}
        self.assertEqual(names,{'Maria Express','Colégio Interação','IOA','Unicesumar'})
        self.assertTrue(all(s['node_id'] is None for s in self.data['stores'] if s['source_page']==1))
    def test_small_units_are_not_erased_by_anchor_outlines(self):
        from plan_geometry import inside
        byid={s['id']:s for s in self.data['stores']}
        anchor=next(s for s in self.data['stores'] if s['name']=='Renner')
        for sid in ['f0-loja-03','f0-loja-04','f0-loja-05']:
            shop=byid[sid];self.assertGreater(len(shop['polygon']),2)
            self.assertFalse(inside((shop['x'],shop['z']),anchor['polygon']),sid)

    def test_external_restaurants_have_no_internal_entry(self):
        for name in ['Madero','Outback']:
            s=next(s for s in self.data['stores'] if s['name']==name)
            self.assertTrue(s['external']);self.assertEqual(s['access_type'],'external_only')
            self.assertIsNone(s['node_id']);self.assertEqual(s['route_status'],'unavailable')
        vivara=next(s for s in self.data['stores'] if s['name']=='Vivara')
        self.assertEqual(vivara['source_label'],'LOJA 29');self.assertTrue(vivara['polygon']);self.assertTrue(vivara['featured'])

    def test_external_madero_is_present_without_unverified_route(self):
        s=next(s for s in self.data['stores'] if s['name']=='Madero')
        self.assertEqual(s['source_label'],'EXT 01')
        self.assertEqual(s['source_page'],2)
        self.assertAlmostEqual(s['area_m2'],181.28)
        self.assertTrue(s['external']); self.assertEqual(len(s['polygon']),6)
        self.assertIsNone(s['node_id']); self.assertEqual(s['route_status'],'unavailable')

    def test_main_routes(self):
        for name in ['Renner','C&A','Riachuelo','Cinemark','Marisa','Centauro','Camicado','Pernambucanas']:
            r=self.route('g-south-entrance',name)
            self.assertGreater(r['distance'],0)
            self.assertAlmostEqual(r['distance'],sum(s['distance'] for s in r['segments']),delta=.06)
    def test_food_court_routes(self):
        for name in ["McDonald's",'Subway','Giraffas','Divino Fogão']:
            self.assertGreater(self.route('u-west-entry',name)['distance'],0)
    def test_interfloor_not_fabricated(self):
        with self.assertRaises(NavigationError) as e:self.route('g-south-entrance','Subway')
        self.assertEqual(e.exception.status,422)
        self.assertIn('pavimentos',e.exception.message)
    def test_no_edges_cross_known_store_interiors(self):
        nodes={n['id']:n for n in self.data['nodes']}
        for e in self.data['edges']:
            a,b=nodes[e['from']],nodes[e['to']]
            for s in self.data['stores']:
                if s['floor_id']==a['floor_id'] and s['polygon']:
                    self.assertFalse(crosses_interior((a['x'],a['z']),(b['x'],b['z']),s['polygon']),s['name'])
    def test_uncertain_footprints_have_no_fake_route(self):
        for s in self.data['stores']:
            if not s['polygon']:
                self.assertIsNone(s['node_id']);self.assertEqual(s['route_status'],'unavailable')
    def test_invalid_shortcut_rejected(self):
        d=copy.deepcopy(self.data);s=next(s for s in d['stores'] if s['name']=='Cinemark')
        a={'id':'bad-a','x':s['x']-2,'z':s['z'],'y':0,'floor_id':'f0'};b=dict(a,id='bad-b',x=s['x']+2)
        d['nodes'] +=[a,b];d['edges'].append({'from':'bad-a','to':'bad-b','kind':'corridor','distance':4,'accessible':True})
        with self.assertRaises(ValueError):validate_graph(d)

if __name__=='__main__':unittest.main()
