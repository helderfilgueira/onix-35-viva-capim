"""Small dependency-free checks for public plan polygons and corridor segments."""
import math

def point_on_boundary(point,poly,tolerance=.002):
    x,z=point
    for a,b in zip(poly,poly[1:]+poly[:1]):
        dx,dz=b[0]-a[0],b[1]-a[1];den=dx*dx+dz*dz
        if not den:continue
        t=max(0,min(1,((x-a[0])*dx+(z-a[1])*dz)/den))
        if math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<=tolerance:return True
    return False

def inside(point,poly):
    if point_on_boundary(point,poly):return False
    x,y=point;result=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:result=not result
    return result

def crosses_interior(a,b,poly):
    # Find every intersection parameter, then inspect each intervening interval.
    dx,dy=b[0]-a[0],b[1]-a[1];ts=[0.,1.]
    for c,d in zip(poly,poly[1:]+poly[:1]):
        ex,ey=d[0]-c[0],d[1]-c[1];den=dx*ey-dy*ex
        if abs(den)<1e-10:continue
        qx,qy=c[0]-a[0],c[1]-a[1];t=(qx*ey-qy*ex)/den;u=(qx*dy-qy*dx)/den
        if 0<t<1 and 0<=u<=1:ts.append(t)
    ts.sort()
    return any(inside((a[0]+dx*(lo+hi)/2,a[1]+dy*(lo+hi)/2),poly) for lo,hi in zip(ts,ts[1:]) if hi-lo>1e-8)

def validate_plan(data,nodes):
    footprints=[]
    for s in data['stores']:
        poly=s.get('polygon',[])
        if poly:
            if len(poly)<3 or any(len(p)!=2 or any(type(x) not in (int,float) or not math.isfinite(x) for x in p) for p in poly):raise ValueError('Invalid footprint')
            footprints.append(s)
        if s.get('node_id'):
            n=nodes[s['node_id']]
            if not poly or not point_on_boundary((n['x'],n['z']),poly):raise ValueError('Entrance not on plan facade')
        elif s.get('route_status')!='unavailable':raise ValueError('Missing entrance must be unavailable')
    for e in data['edges']:
        a,b=nodes[e['from']],nodes[e['to']]
        if a['floor_id']!=b['floor_id'] and data.get('interfloor_status')=='unconfirmed':raise ValueError('Unconfirmed vertical link')
        p=(a['x'],a['z']);q=(b['x'],b['z'])
        for s in footprints:
            if s['floor_id']==a['floor_id'] and crosses_interior(p,q,s['polygon']):raise ValueError('Route crosses retail interior: '+s['id'])
