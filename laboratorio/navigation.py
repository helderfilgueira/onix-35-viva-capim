"""Public, synthetic indoor navigation. No visitor state or location history."""
import heapq
import json
import math
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / 'static' / 'navigation-data.json'
_catalog_cache = None


class NavigationError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def validate_graph(data):
    if not isinstance(data.get('version'), str) or not data['version'].strip():
        raise ValueError('Invalid map version')
    floors = {floor['id']: floor for floor in data['floors']}
    if len(floors) != len(data['floors']) or not floors:
        raise ValueError('Invalid floors')
    nodes = {n['id']: n for n in data['nodes']}
    if len(nodes) != len(data['nodes']):
        raise ValueError('Duplicate node ID')
    for node in nodes.values():
        if not isinstance(node['id'], str) or not node['id']:
            raise ValueError('Invalid node ID')
        if any(type(node.get(k)) not in (int, float) or not math.isfinite(node[k]) for k in ('x', 'y', 'z')):
            raise ValueError('Invalid coordinates')
        if node.get('floor_id') not in floors or node['y'] != floors[node['floor_id']]['y']:
            raise ValueError('Node floor mismatch')
    for edge in data['edges']:
        if edge['from'] not in nodes or edge['to'] not in nodes:
            raise ValueError('Unknown endpoint')
        if type(edge['distance']) not in (int, float) or not math.isfinite(edge['distance']) or edge['distance'] <= 0:
            raise ValueError('Invalid distance')
        if type(edge['accessible']) is not bool:
            raise ValueError('Invalid accessibility')
        if edge.get('kind') not in ('corridor', 'entrance', 'stairs', 'escalator', 'elevator'):
            raise ValueError('Invalid edge kind')
        if any(type(edge.get(flag, default)) is not bool for flag, default in [('blocked', False), ('bidirectional', True)]):
            raise ValueError('Invalid edge flag')
        a, b = nodes[edge['from']], nodes[edge['to']]
        if a['floor_id'] != b['floor_id'] and edge['kind'] not in ('stairs', 'escalator', 'elevator'):
            raise ValueError('Unspecified vertical connection')
        # Independent floor drawings do not share an x/z origin: never measure a lift
        # by the diagonal between two page-local coordinates.
        vertical=a['floor_id']!=b['floor_id']
        if vertical and data.get('geometry_source')=='pdf-vector':
            connections={c['id']:c for c in data.get('vertical_connections',[])}
            c=connections.get(edge.get('connection_id'))
            if not c or (edge['from'],edge['to'])!=(c['from_node'],c['to_node']) or edge['kind']!=c['kind']:
                raise ValueError('Undocumented vertical connection')
            if edge.get('coordinate_space')!='independent_floor_portals':raise ValueError('Vertical coordinate model missing')
            if edge['kind'] in ('stairs','escalator') and edge['accessible']:raise ValueError('Steps cannot be accessible')
            if edge['distance']+1e-9<abs(a['y']-b['y']):raise ValueError('Invalid vertical distance')
        elif edge['distance'] + 1e-9 < math.dist((a['x'], a['y'], a['z']), (b['x'], b['y'], b['z'])):
            raise ValueError('Distance shorter than straight line')
    for place in data['stores'] + data.get('places', []):
        if data.get('geometry_source')=='pdf-vector' and place.get('node_id') is None:
            continue
        if place['node_id'] not in nodes:
            raise ValueError('Unknown entrance')
        if place.get('floor_id') != nodes[place['node_id']]['floor_id']:
            raise ValueError('Place floor mismatch')
    for anchor in data.get('anchors', []):
        if anchor.get('node_id') not in nodes:
            raise ValueError('Unknown anchor')
    for collection in ('stores', 'places', 'anchors'):
        ids = [item['id'] for item in data.get(collection, [])]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate catalog ID')
    if data.get('geometry_source')=='pdf-vector':
        from plan_geometry import validate_plan
        validate_plan(data,nodes)
        return nodes
    for store in data['stores']:
        if any(type(store.get(k)) not in (int, float) or not math.isfinite(store[k]) for k in ('x', 'z', 'width', 'depth')) or min(store['width'], store['depth']) <= 0:
            raise ValueError('Invalid store geometry')
        entrance = nodes[store['node_id']]
        dx, dz = abs(entrance['x'] - store['x']), abs(entrance['z'] - store['z'])
        w, h = store['width'] / 2, store['depth'] / 2
        if not ((math.isclose(dx,w) and dz <= h) or (math.isclose(dz,h) and dx <= w)):
            raise ValueError('Entrance is not on facade')
    for i, first in enumerate(data['stores']):
        for second in data['stores'][i+1:]:
            if first['floor_id'] == second['floor_id'] and abs(first['x'] - second['x']) < (first['width'] + second['width']) / 2 and abs(first['z'] - second['z']) < (first['depth'] + second['depth']) / 2:
                raise ValueError('Overlapping stores')
    return nodes


def load_navigation():
    global _catalog_cache
    stamp = DATA_PATH.stat().st_mtime_ns
    if _catalog_cache and _catalog_cache[0] == stamp:
        return _catalog_cache[1]
    data = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    validate_graph(data)
    _catalog_cache = (stamp, data)
    return data


def calculate_route(request, data=None):
    trusted = data is None
    data = load_navigation() if data is None else data
    if not isinstance(request, dict) or set(request) != {'origin', 'destination', 'accessible', 'map_version'}:
        raise NavigationError(400, 'Informe origem, destino, preferência de acessibilidade e versão do mapa.')
    if not all(isinstance(request[k], str) for k in ('origin', 'destination', 'map_version')) or type(request['accessible']) is not bool:
        raise NavigationError(400, 'Parâmetros de rota inválidos.')
    if request['map_version'] != data['version']:
        raise NavigationError(409, 'Mapa atualizado. Recarregue o catálogo e tente novamente.')
    nodes = {n['id']: n for n in data['nodes']} if trusted else validate_graph(data)
    start, end = request['origin'], request['destination']
    if start not in nodes or end not in nodes:
        raise NavigationError(404, 'Origem ou destino não encontrado no mapa.')
    if data.get('interfloor_status')=='unconfirmed' and nodes[start]['floor_id']!=nodes[end]['floor_id']:
        raise NavigationError(422, 'Ligação entre pavimentos ainda não confirmada na planta. Selecione um ponto de partida no piso do destino.')
    adjacency = {n: [] for n in nodes}
    for edge in data['edges']:
        if edge.get('blocked', False):
            continue
        if request['accessible'] and (not edge['accessible'] or edge['kind'] in ('stairs','escalator')):
            continue
        adjacency[edge['from']].append((edge['to'], edge))
        if edge.get('bidirectional', True):
            adjacency[edge['to']].append((edge['from'], edge))
    distances, previous, queue = {start: 0}, {}, [(0, start)]
    while queue:
        distance, current = heapq.heappop(queue)
        if distance != distances[current]:
            continue
        if current == end:
            break
        for target, edge in adjacency[current]:
            candidate = distance + edge['distance']
            if candidate < distances.get(target, float('inf')):
                distances[target], previous[target] = candidate, (current, edge)
                heapq.heappush(queue, (candidate, target))
    if end not in distances and request['accessible'] and nodes[start]['floor_id']!=nodes[end]['floor_id']:
        raise NavigationError(422,'Não há ligação sem degraus confirmada entre esta origem e o destino. Nenhuma escada ou escada rolante foi incluída. Escolha uma origem junto a um elevador com conexão indicada, se você já estiver nesse ponto.')
    if end not in distances:
        raise NavigationError(422, 'Nenhum percurso disponível para esta preferência. Procure orientação no local.')
    path, segments, current = [end], [], end
    while current != start:
        parent, edge = previous[current]
        segments.append({'from': parent, 'to': current, 'kind': edge['kind'], 'distance': edge['distance'], 'connection_id':edge.get('connection_id'), 'label':edge.get('label'), 'from_floor':nodes[parent]['floor_id'], 'to_floor':nodes[current]['floor_id']})
        path.append(parent)
        current = parent
    path.reverse()
    segments.reverse()
    floors = {f['id']: f['name'] for f in data['floors']}
    instructions = []
    instruction_tokens = []
    for segment in segments:
        target = nodes[segment['to']]
        if segment['kind'] in ('stairs', 'escalator', 'elevator'):
            means={'elevator':'o elevador','escalator':'a escada rolante','stairs':'a escada'}[segment['kind']]
            instructions.append(f"Use {means} até {floors[target['floor_id']]}. Ao chegar, continue no trecho desse piso.")
            instruction_tokens.append({'code':'transfer','params':{'kind':segment['kind'],'target_floor_id':target['floor_id'],'target_floor_name':floors[target['floor_id']]}})
        else:
            instructions.append(f"Siga cerca de {segment['distance']:.1f} m até {target.get('label', 'o próximo ponto')}.")
            instruction_tokens.append({'code':'walk','params':{'distance_m':round(segment['distance'],1),'target_node_id':target['id'],'target_label':target.get('label','o próximo ponto'),'target_floor_id':target['floor_id']}})
    instructions.append('Você chegou ao ponto de entrada do destino.' if segments else 'Origem e destino são o mesmo ponto.')
    instruction_tokens.append({'code':'arrived' if segments else 'same_point','params':{}})
    floor_steps=[]
    for i,nid in enumerate(path):
        fid=nodes[nid]['floor_id']
        if not floor_steps or floor_steps[-1]['floor_id']!=fid:
            floor_steps.append({'floor_id':fid,'name':floors[fid],'start_index':i,'end_index':i,'distance':0.0,'transfer':None})
        floor_steps[-1]['end_index']=i
        if i<len(segments):
            seg=segments[i]
            if seg['from_floor']!=seg['to_floor']:floor_steps[-1]['transfer']={'kind':seg['kind'],'label':seg['label'],'to_floor':seg['to_floor'],'to_name':floors[seg['to_floor']],'connection_id':seg['connection_id']}
            else:floor_steps[-1]['distance']+=seg['distance']
    for step in floor_steps:step['distance']=round(step['distance'],1)
    return {'version': data['version'], 'path': [nodes[n] for n in path],
            'distance': round(distances[end], 1), 'instructions': instructions, 'instruction_tokens':instruction_tokens,
            'warning_token':{'code':'inferred_plan' if data.get('geometry_source') else 'schematic','params':{}},
            'segments': segments, 'floor_steps':floor_steps, 'accessible_requested':request['accessible'], 'demo': True,
            'warning': 'Percurso inferido da planta. Distâncias estimadas e acessibilidade não validadas no shopping.' if data.get('geometry_source') else 'Percurso esquemático demonstrativo. Distâncias e acessibilidade não validadas no shopping.'}
