import * as THREE from './vendor/three.module.js';

// Procedural, editable demonstration model. Coordinates come from the route graph.
export function createMallScene(container, data, onSelect) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8eee7');
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Maquete 3D demonstrativa. Selecione uma loja ou use a lista acessível.');
  const camera = new THREE.OrthographicCamera(-40,40,30,-30,.1,300);
  const center = new THREE.Vector3(0,0,0);
  let angle=.68, zoom=1, floor=data.floors[0].id, reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let disposed=false, selected=null, route=[], origin=null, lastFrame=0, frames=0, elapsed=0;
  const floors=new Map(), clickable=[], storeMeshes=new Map();
  scene.add(new THREE.HemisphereLight(0xffffff,0x607060,1.8));
  const sun=new THREE.DirectionalLight(0xfff7dc,2.2); sun.position.set(15,55,20);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-45,right:45,top:35,bottom:-35}); scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(250,250),new THREE.MeshStandardMaterial({color:0xe8eee7,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-1.2;ground.receiveShadow=true;scene.add(ground);
  const routeGroup=new THREE.Group(); scene.add(routeGroup);
  function box(parent,x,y,z,w,h,d,color){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function label(text,x,y,z,parent,width=8){
    const cv=document.createElement('canvas');cv.width=512;cv.height=96;const ctx=cv.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,96);ctx.fillStyle='#203b30';ctx.font='600 29px system-ui';ctx.textAlign='center';ctx.fillText(text,256,59,485);
    const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));sprite.position.set(x,y,z);sprite.scale.set(width,width*96/512,1);parent.add(sprite);return sprite;
  }
  for(const fl of data.floors){
    const group=new THREE.Group();floors.set(fl.id,group);scene.add(group);
    box(group,0,-.55,0,64,1,37,'#f9f8f0');
    box(group,0,.015,0,59,.08,8,'#d8dfd5');
    for(let x=-27;x<=27;x+=3)box(group,x,.07,0,1,.04,.08,'#becbbd');
    for(const st of data.stores.filter(s=>s.floor_id===fl.id)){
      const c=st.color||'#a8bfa2';
      const m=box(group,st.x,1.7,st.z,st.width,3.4,st.depth,c);m.userData.store=st.id;clickable.push(m);storeMeshes.set(st.id,m);
      box(group,st.x,3.46,st.z,st.width+.15,.12,st.depth+.15,'#fffdf6');
      const facing=st.z>0?-1:1;
      box(group,st.x,1.35,st.z+facing*(st.depth/2+.04),st.width*.76,2.25,.08,'#b7d2cc');
      box(group,st.x,.06,st.z+facing*(st.depth/2+1.0),2,.10,2,'#eee9db');
      label(st.name,st.x,4.6,st.z,group,8.2);
    }
    for(const x of [-27,27])for(const z of [-12,12]){
      box(group,x,.35,z,2,.7,2,'#a5b09a');box(group,x,1.2,z,.25,1.5,.25,'#7e6c50');
      const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.35,1),new THREE.MeshStandardMaterial({color:'#648c62',roughness:1}));crown.position.set(x,2.4,z);crown.castShadow=true;group.add(crown);
    }
    for(const [x,txt,color] of [[24,'ELEVADOR','#d5e7a2'],[-24,'ESCADA','#e5c9b4']]){box(group,x,.25,0,3,.5,4,color);label(txt,x,2,0,group,5);}
    for(const p of (data.places||[]).filter(p=>p.floor_id===fl.id)){
      const n=data.nodes.find(n=>n.id===p.node_id); if(n)label(p.name,n.x,1.4,n.z,group,5.5);
    }
  }
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.6,20,14),new THREE.MeshStandardMaterial({color:'#186de1',emissive:'#1555aa',emissiveIntensity:.2}));scene.add(marker);marker.visible=false;
  const halo=new THREE.Mesh(new THREE.RingGeometry(.85,1.15,40),new THREE.MeshBasicMaterial({color:'#186de1',side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;scene.add(halo);halo.visible=false;
  function updateCamera(){const aspect=Math.max(container.clientWidth,1)/Math.max(container.clientHeight,1);const span=aspect<1.2?40:28;camera.left=-span*aspect;camera.right=span*aspect;camera.top=span;camera.bottom=-span;camera.zoom=zoom;camera.position.set(Math.sin(angle)*65,60,Math.cos(angle)*65);camera.lookAt(center);camera.updateProjectionMatrix();}
  function resize(){renderer.setSize(Math.max(container.clientWidth,1),Math.max(container.clientHeight,1));updateCamera();}
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function clearRoute(){while(routeGroup.children.length){const c=routeGroup.children.pop();c.geometry?.dispose();c.material?.dispose();}}
  function drawRoute(){clearRoute();for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i];if(a.floor_id!==floor||b.floor_id!==floor)continue;
    const start=new THREE.Vector3(a.x,.35,a.z),end=new THREE.Vector3(b.x,.35,b.z),dir=end.clone().sub(start);
    if(!dir.length())continue;
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,dir.length(),10),new THREE.MeshStandardMaterial({color:'#c8ed65',emissive:'#92bf36',emissiveIntensity:.3}));
    mesh.position.copy(start).add(end).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());routeGroup.add(mesh);
    const arrow=new THREE.ArrowHelper(dir,start.clone().lerp(end,.65),1.5,0x345a25,.8,.7);routeGroup.add(arrow);
  }}
  function showOrigin(){marker.visible=halo.visible=Boolean(origin&&origin.floor_id===floor);if(origin){marker.position.set(origin.x,.85,origin.z);halo.position.set(origin.x,.12,origin.z);}}
  function setFloor(id){if(!floors.has(id))return;floor=id;for(const [key,g]of floors)g.visible=key===id;drawRoute();showOrigin();}
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
  function hit(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);return ray.intersectObjects(clickable.filter(m=>m.parent.visible))[0];}
  function pointerDown(e){down={x:e.clientX,y:e.clientY,angle};}
  function pointerMove(e){if(down&&e.buttons){angle=down.angle+(e.clientX-down.x)*.005;updateCamera();}else renderer.domElement.style.cursor=hit(e)?'pointer':'grab';}
  function pointerUp(e){if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<8){const h=hit(e);if(h)onSelect(h.object.userData.store);}down=null;}
  function wheel(e){e.preventDefault();zoom=THREE.MathUtils.clamp(zoom-e.deltaY*.001,0.65,2.1);updateCamera();}
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointerleave',()=>{down=null;});renderer.domElement.addEventListener('wheel',wheel,{passive:false});
  function tick(t){if(disposed)return;requestAnimationFrame(tick);if(container.hidden||document.hidden){lastFrame=0;return;}if(lastFrame){elapsed+=t-lastFrame;frames++;}lastFrame=t;if(!reduced&&halo.visible){const s=1+Math.sin(t*.002)*.06;halo.scale.setScalar(s);}renderer.render(scene,camera);}
  setFloor(floor);requestAnimationFrame(tick);
  return {setFloor,setRoute(path){route=path||[];drawRoute();},setOrigin(node){origin=node;showOrigin();},setReducedMotion(value){reduced=value;halo.scale.setScalar(1);},selectStore(id){selected=id;for(const [key,m]of storeMeshes){m.material.emissive.set(key===selected?'#416d2e':'#000000');m.material.emissiveIntensity=.35;}},getMetrics(){return {fps:elapsed?Math.round(frames*1000/elapsed):0,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries};},dispose(){disposed=true;observer.disconnect();scene.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});renderer.dispose();renderer.domElement.remove();}};
}
