import copy
import json
import unittest
from pathlib import Path
from navigation import calculate_route


class RouteInstructionTokensTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((Path(__file__).parent/'tests'/'demo-graph.json').read_text(encoding='utf-8'))

    def route(self,accessible=False,origin='f0-c0',destination='loja-07-entrada',data=None):
        return calculate_route({'origin':origin,'destination':destination,'accessible':accessible,'map_version':self.data['version']},data or self.data)

    def test_tokens_align_with_segments_and_keep_portuguese_instructions(self):
        for accessible in (False,True):
            result=self.route(accessible)
            self.assertEqual(len(result['instruction_tokens']),len(result['instructions']))
            self.assertEqual(result['instruction_tokens'][-1],{'code':'arrived','params':{}})
            self.assertEqual(result['instructions'][-1],'Você chegou ao ponto de entrada do destino.')
            for segment,token,instruction in zip(result['segments'],result['instruction_tokens'],result['instructions']):
                params=token['params']
                if segment['kind'] in ('stairs','escalator','elevator'):
                    self.assertEqual(token['code'],'transfer')
                    self.assertEqual(params['kind'],segment['kind'])
                    self.assertEqual(params['target_floor_id'],segment['to_floor'])
                    self.assertIn(params['target_floor_name'],instruction)
                else:
                    self.assertEqual(token['code'],'walk')
                    self.assertEqual(params['distance_m'],round(segment['distance'],1))
                    self.assertEqual(params['target_node_id'],segment['to'])
                    self.assertIn(params['target_label'],instruction)
            self.assertEqual(result['warning_token'],{'code':'schematic','params':{}})

    def test_same_point_has_one_token_and_no_segments(self):
        result=self.route(origin='f0-c0',destination='f0-c0')
        self.assertEqual(result['instruction_tokens'],[{'code':'same_point','params':{}}])
        self.assertEqual(result['segments'],[])
        self.assertEqual(result['distance'],0)

    def test_transfers_preserve_accessibility_and_input_graph(self):
        original=copy.deepcopy(self.data)
        normal=self.route();accessible=self.route(True)
        self.assertEqual(self.data,original)
        self.assertIn('stairs',[t['params']['kind'] for t in normal['instruction_tokens'] if t['code']=='transfer'])
        self.assertEqual([t['params']['kind'] for t in accessible['instruction_tokens'] if t['code']=='transfer'],['elevator'])
        self.assertGreater(accessible['distance'],normal['distance'])
        self.data['geometry_source']='plan'
        self.assertEqual(self.route()['warning_token']['code'],'inferred_plan')


if __name__=='__main__':unittest.main()
