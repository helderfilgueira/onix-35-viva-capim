import unittest,copy
from navigation import load_navigation,calculate_route,validate_graph,NavigationError
class InterfloorTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.d=load_navigation()
 def route(self,origin,destination,accessible=False,data=None):
  d=data or self.d
  return calculate_route({'origin':origin,'destination':destination,'accessible':accessible,'map_version':d['version']},d)
 def target(self,name):return next(s['node_id'] for s in self.d['stores'] if s['name']==name)
 def test_public_stairs_connect_both_directions(self):
  d=copy.deepcopy(self.d)
  for e in d['edges']:
   if e['kind'] in ('escalator','elevator'):e['blocked']=True
  for a,b in [('g-south-entrance',self.target('Subway')),('u-west-entry',self.target('Renner'))]:
   r=self.route(a,b,data=d);self.assertTrue(any(e['kind']=='stairs' for e in r['segments']));self.assertEqual(len(r['floor_steps']),2)
 def test_escalators_respect_up_and_down(self):
  d=copy.deepcopy(self.d)
  for e in d['edges']:
   if e['kind'] in ('stairs','elevator'):e['blocked']=True
  up=self.route('g-south-entrance',self.target('Subway'),data=d);down=self.route('u-west-entry',self.target('Renner'),data=d)
  self.assertIn('f0-f1-escalator-up',[e['connection_id'] for e in up['segments']]);self.assertNotIn('f0-f1-escalator-down',[e['connection_id'] for e in up['segments']])
  self.assertIn('f0-f1-escalator-down',[e['connection_id'] for e in down['segments']])
 def test_accessible_route_uses_lift_from_explicit_door_origin(self):
  origin=next(a['node_id'] for a in self.d['anchors'] if a.get('source')=='manual_portal_origin')
  r=self.route(origin,self.target('Subway'),True)
  self.assertTrue(any(e['kind']=='elevator' for e in r['segments']));self.assertFalse(any(e['kind'] in ('stairs','escalator') for e in r['segments']))
  self.assertEqual([s['floor_id'] for s in r['floor_steps']],['f0','f1'])
 def test_no_fabricated_accessible_approach_or_stair_fallback(self):
  with self.assertRaises(NavigationError) as e:self.route('g-south-entrance',self.target('Subway'),True)
  self.assertEqual(e.exception.status,422);self.assertIn('sem degraus',e.exception.message)
 def test_blocked_lift_has_no_accessible_alternative(self):
  d=copy.deepcopy(self.d)
  for e in d['edges']:
   if e['kind']=='elevator':e['blocked']=True
  origin=next(a['node_id'] for a in d['anchors'] if a.get('source')=='manual_portal_origin')
  with self.assertRaises(NavigationError):self.route(origin,self.target('Subway'),True,d)
 def test_vertical_connection_requires_matching_documented_portals(self):
  d=copy.deepcopy(self.d);e=next(e for e in d['edges'] if e['kind']=='elevator');e['connection_id']='invented'
  with self.assertRaises(ValueError):validate_graph(d)
 def test_transition_distances_are_not_page_coordinate_diagonals(self):
  self.assertTrue(all(e['distance'] in (9,16) for e in self.d['edges'] if e.get('connection_id')))
  self.assertTrue(all(c['distance_status']=='transfer_cost_estimate_not_surveyed_height' for c in self.d['vertical_connections']))
if __name__=='__main__':unittest.main()
