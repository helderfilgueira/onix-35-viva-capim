"""Export reusable cube geometry and schematic shops as editable glTF 2.0."""
import json, struct, base64
from pathlib import Path
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'static/navigation-data.json').read_text(encoding='utf-8'))
positions=[-.5,-.5,-.5,.5,-.5,-.5,.5,.5,-.5,-.5,.5,-.5,-.5,-.5,.5,.5,-.5,.5,.5,.5,.5,-.5,.5,.5]
indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]
verts=struct.pack('<24f',*positions); inds=struct.pack('<36H',*indices); blob=verts+inds
doc={'asset':{'version':'2.0','generator':'Onix35 procedural schematic exporter'},'scene':0,'scenes':[{'nodes':[]}], 'nodes':[], 'meshes':[], 'materials':[], 'buffers':[{'uri':'data:application/octet-stream;base64,'+base64.b64encode(blob).decode(),'byteLength':len(blob)}], 'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(verts),'target':34962},{'buffer':0,'byteOffset':len(verts),'byteLength':len(inds),'target':34963}], 'accessors':[{'bufferView':0,'componentType':5126,'count':8,'type':'VEC3','min':[-.5,-.5,-.5],'max':[.5,.5,.5]},{'bufferView':1,'componentType':5123,'count':36,'type':'SCALAR'}], 'extras':{'notice':data['notice'],'version':data['version'],'units':'schematic metres, not validated in venue'}}
for s in data['stores']:
 c=s['color'].lstrip('#');rgb=[int(c[i:i+2],16)/255 for i in (0,2,4)]
 i=len(doc['materials']);doc['materials'].append({'name':s['id'],'pbrMetallicRoughness':{'baseColorFactor':rgb+[1],'metallicFactor':0,'roughnessFactor':.9}})
 doc['meshes'].append({'name':s['id'],'primitives':[{'attributes':{'POSITION':0},'indices':1,'material':i}]})
 y=next(f['y'] for f in data['floors'] if f['id']==s['floor_id'])
 doc['nodes'].append({'name':s['name'],'mesh':i,'translation':[s['x'],y+1.7,s['z']],'scale':[s['width'],3.4,s['depth']],'extras':{'store_id':s['id'],'floor_id':s['floor_id'],'entrance_node_id':s['node_id']}});doc['scenes'][0]['nodes'].append(i)
dest=root/'assets';dest.mkdir(exist_ok=True);(dest/'shopping-demo.gltf').write_text(json.dumps(doc,ensure_ascii=False,indent=2),encoding='utf-8')
print('Exported',len(doc['nodes']),'store nodes; embedded buffer',len(blob),'bytes')

