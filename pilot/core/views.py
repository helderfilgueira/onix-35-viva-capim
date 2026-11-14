import json, mimetypes, sys, hashlib, secrets
from io import StringIO
from datetime import timedelta
from pathlib import Path
from django.conf import settings
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import transaction, IntegrityError, OperationalError, connection
from django.db.models import Count, Avg, Sum, Q
from django.http import JsonResponse, FileResponse, Http404
from django.middleware.csrf import get_token
from django.shortcuts import render, redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from .models import Organization, StaffProfile, Event, Content, Benefit, Member, Review, Redemption, Ledger, LocationLock
from .services import DomainError, require, text, integer, phone, datetime_value, translations, image, verify_publish, audit, rate_limit, member_json, register, create_review, redeem, reverse, redemption_json

sys.path.insert(0,str(settings.LEGACY_DIR))
from navigation import load_navigation, calculate_route, NavigationError
User=get_user_model()

def response(data,status=200):return JsonResponse(data,status=status)
def csrf_failure(request,reason=''):return response({'error':'Sessão de segurança inválida. Atualize a página.','code':'csrf'},403)
def body(request,allowed):
    require(request.content_type=='application/json','Envie JSON.',415)
    require(len(request.body)<=450000,'Requisição muito grande.',413)
    try:data=json.loads(request.body)
    except (ValueError,UnicodeDecodeError):raise DomainError('JSON inválido.')
    require(isinstance(data,dict) and not set(data)-set(allowed),'Campos inválidos.')
    return data

def identity(request,required=True):
    if not request.user.is_authenticated:
        if required:raise DomainError('Entre na conta da equipe.',401,'authentication_required')
        return None
    if request.user.is_superuser:return {'id':request.user.id,'username':request.user.username,'role':'admin','organization_id':None,'organization_name':None}
    try:p=request.user.pilot_profile
    except StaffProfile.DoesNotExist:raise DomainError('Conta sem acesso ao piloto.',403)
    require(request.user.is_active and (p.role=='admin' or p.organization and p.organization.active),'Acesso suspenso.',403)
    return {'id':request.user.id,'username':request.user.username,'role':p.role,'organization_id':p.organization_id,'organization_name':p.organization.name if p.organization else None}

def administrator(who):require(who['role']=='admin','Acesso exclusivo da administração.',403)
def editor(who):require(who['role'] in ('admin','partner'),'Perfil de balcão não edita conteúdo.',403)
def scope(query,who):return query if who['role']=='admin' else query.filter(organization_id=who['organization_id'])
def scoped_object(model,pk,who):
    obj=scope(model.objects.select_for_update(),who).filter(pk=pk).first();require(obj is not None,'Registro não encontrado.',404);return obj

def editorial_json(obj):
    data={'id':obj.id,'organization_id':obj.organization_id,'organization_name':obj.organization.name,'title':obj.title,'description':obj.description,'translations':obj.translations,'status':obj.status}
    for field in ('location','starts','ends','kind','theme','points_cost','stock','image_data','image_alt','target_url','discoveries'):
        if hasattr(obj,field):
            value=getattr(obj,field);data[field]=value.isoformat() if hasattr(value,'isoformat') else value
    return data

def public_query(model):
    query=model.objects.filter(status='approved',organization__active=True)
    if model==Content:query=query.filter(starts__lte=timezone.now(),ends__gt=timezone.now())
    if model==Event:query=query.filter(ends__gt=timezone.now()-timedelta(days=30))
    if model==Benefit:query=query.filter(stock__gt=0,starts__lte=timezone.now(),ends__gt=timezone.now())
    return query.select_related('organization').order_by('id')

def organization_json(o):return {'id':o.id,'name':o.name,'kind':o.kind,'store_id':o.store_id,'active':o.active}

def target(data):
    kind=data.get('target_type');tid=str(data.get('target_id',''))
    if kind=='store':
        store=next((s for s in load_navigation()['stores'] if s['id']==tid and s.get('unit_type') not in ('facility','structure')),None)
        require(store is not None,'Loja não encontrada.',404)
        return Organization.objects.filter(store_id=tid,active=True).first()
    require(kind=='event','Tipo de avaliação inválido.')
    require(tid.isascii() and tid.isdecimal() and len(tid)<=19,'Identificador de evento inválido.')
    event_id=int(tid)
    require(tid==str(event_id) and 1<=event_id<=9223372036854775807,'Identificador de evento inválido.')
    event=Event.objects.filter(pk=event_id,status='approved',organization__active=True).first()
    require(event is not None,'Evento não encontrado.',404)
    require(event.starts<=timezone.now() and event.ends>=timezone.now()-timedelta(days=30),'A avaliação fica disponível durante o evento e por trinta dias após seu término.',409)
    return event.organization

def aggregate(query):
    return [{'target_type':r['target_type'],'target_id':r['target_id'],'count':r['count'] if r['count']>=5 else None,'average':round(r['average'],2) if r['count']>=5 else None,'status':'available' if r['count']>=5 else 'insufficient_sample'} for r in query.values('target_type','target_id').annotate(count=Count('id'),average=Avg('score')).order_by('target_type','target_id')]

def editorial_edit(model,request,who,pk=None,action=None):
    require(who['role']!='cashier' or (model==Benefit and request.method=='GET' and pk is None),'Acesso exclusivo da gestão.',403)
    if request.method=='GET' and pk is None:return response({'items':[editorial_json(o) for o in scope(model.objects.select_related('organization'),who).order_by('-id')[:250]]})
    editor(who)
    allowed={'organization_id','title','description','translations'}
    if model==Event:allowed|={'location','starts','ends'}
    elif model==Content:allowed|={'kind','theme','starts','ends','image_data','image_alt','target_url','discoveries'}
    else:allowed|={'points_cost','stock','starts','ends'}
    data=body(request,[] if action else allowed)
    require(request.method==('POST' if pk is None or action else 'PATCH'),'Método não permitido.',405)
    with transaction.atomic():
        obj=scoped_object(model,pk,who) if pk else model()
        if action:
            if action=='approve':
                administrator(who);verify_publish(obj)
                if model==Event:
                    LocationLock.objects.get_or_create(name=obj.location)
                    LocationLock.objects.select_for_update().get(name=obj.location)
                    require(not Event.objects.exclude(pk=obj.pk).filter(location=obj.location,status='approved',starts__lt=obj.ends,ends__gt=obj.starts).exists(),'Local ocupado neste período.',409)
                obj.status='approved'
            elif action=='pause':obj.status='paused'
            else:raise DomainError('Ação inválida.',404)
        else:
            if not pk:
                orgid=data.get('organization_id') if who['role']=='admin' else who['organization_id']
                org=Organization.objects.filter(pk=orgid,active=True).first();require(org is not None,'Selecione uma organização ativa.');obj.organization=org
            elif 'organization_id' in data:require(data['organization_id']==obj.organization_id,'Não é possível mudar a organização.')
            for field in ('title','description','location','theme','image_alt'):
                if field in data:setattr(obj,field,text(data[field],field,2000 if field=='description' else 240,field in ('title','location')))
            if 'translations' in data:obj.translations=translations(data['translations'])
            if 'kind' in data:require(data['kind'] in ('ad','campaign','easter_egg'),'Tipo inválido.');obj.kind=data['kind']
            for field in ('starts','ends'):
                if field in data:setattr(obj,field,datetime_value(data[field]))
            for field in ('points_cost','stock'):
                if field in data:setattr(obj,field,integer(data[field],field,1 if field=='points_cost' else 0))
            if 'image_data' in data:obj.image_data=image(data['image_data'])
            if 'target_url' in data:
                value=data['target_url'];require(isinstance(value,str) and len(value)<=2000 and (not value or url_safe(value)),'Destino deve usar HTTPS.');obj.target_url=value
            if 'discoveries' in data:
                require(isinstance(data['discoveries'],list) and len(data['discoveries'])<=3,'Máximo três descobertas.')
                result=[]
                for item in data['discoveries']:
                    require(isinstance(item,dict) and not set(item)-{'id','title','translations'},'Descoberta inválida.')
                    result.append({'id':text(item.get('id'),'Identificador',60),'title':text(item.get('title'),'Título',120),'translations':translations(item.get('translations',{}))})
                require(len({v['id'] for v in result})==len(result),'Identificadores de descobertas repetidos.');obj.discoveries=result
            require(bool(obj.title),'Título obrigatório.')
            if model in (Event,Content):require(obj.starts and obj.ends and obj.ends>obj.starts,'Período inválido.')
            if model==Event:
                require(bool(obj.location),'Local obrigatório.')
                require(not Event.objects.exclude(pk=obj.pk).filter(location=obj.location,status='approved',starts__lt=obj.ends,ends__gt=obj.starts).exists(),'Local ocupado neste período.',409)
            if model==Benefit:require(obj.points_cost is not None and obj.points_cost>0,'Custo deve ser positivo.')
            obj.status='pending'
        obj.full_clean();obj.save();audit(request.user,(action or 'save')+'.'+model.__name__.lower(),obj)
    return response(editorial_json(obj),201 if pk is None else 200)

def url_safe(value):
    from urllib.parse import urlparse
    p=urlparse(value);return p.scheme=='https' and bool(p.hostname) and not p.username and not p.password

def api(request,path):
    try:return api_dispatch(request,path.strip('/'))
    except DomainError as e:return response({'error':e.message,'code':e.code},e.status)
    except ValidationError as e:return response({'error':'; '.join(e.messages),'code':'invalid'},400)
    except (ValueError,TypeError):return response({'error':'Dados inválidos.','code':'invalid'},400)
    except IntegrityError:return response({'error':'Operação duplicada ou conflito de dados.','code':'conflict'},409)
    except OperationalError:return response({'error':'Serviço ocupado. Tente novamente com a mesma chave da operação.','code':'busy'},503)

def api_dispatch(request,path):
    parts=path.split('/')
    if path=='maintenance':
        require(request.method=='GET','Método não permitido.',405)
        secret=settings.CRON_SECRET
        require(isinstance(secret,str) and len(secret)>=32,'Manutenção remota indisponível.',503,'maintenance_disabled')
        authorization=request.headers.get('Authorization','')
        require(secrets.compare_digest(authorization.encode('utf-8'),('Bearer '+secret).encode('utf-8')),'Autorização de manutenção inválida.',401,'maintenance_unauthorized')
        with transaction.atomic():
            LocationLock.objects.get_or_create(name='__pilot_retention__')
            LocationLock.objects.select_for_update().get(name='__pilot_retention__')
            call_command('purge_pilot',stdout=StringIO(),stderr=StringIO())
        return response({'ok':True})
    if path=='health' and request.method=='GET':
        with connection.cursor() as cursor:cursor.execute('SELECT 1');cursor.fetchone()
        return response({'ok':True})
    if path=='session' and request.method=='GET':
        try:who=identity(request,False)
        except DomainError as exc:
            if exc.status!=403:raise
            logout(request);who=None
        return response({'csrf_token':get_token(request),'authenticated':bool(who),'user':who})
    if path=='auth/login' and request.method=='POST':
        rate_limit(request,'login',10,900);data=body(request,('username','password'))
        user=authenticate(request,username=data.get('username'),password=data.get('password'))
        require(user is not None,'Credenciais inválidas.',401)
        login(request,user)
        try:who=identity(request)
        except DomainError:logout(request);raise
        return response({'csrf_token':get_token(request),'authenticated':True,'user':who})
    if path=='auth/logout' and request.method=='POST':logout(request);return response({'ok':True})
    if path=='members/register' and request.method=='POST':
        require(settings.PILOT_OPERATIONS_ENABLED,'Programa temporariamente pausado. Procure o atendimento.',503,'loyalty_paused')
        rate_limit(request,'register',20,3600);data=body(request,('first_name','last_name','phone','age_18','consent','locale'));register(data)
        return response({'ok':True,'message':'Solicitação recebida. Procure o atendimento para ativação presencial.'})
    if path=='reviews' and request.method=='POST':
        rate_limit(request,'reviews',30,3600);data=body(request,('target_type','target_id','score','reason','phone','consent','visited','idempotency_key'))
        org=target(data)
        require(settings.PILOT_OPERATIONS_ENABLED or not data.get('phone'),'Fidelidade pausada. Você pode avaliar sem telefone ou procurar o atendimento.',503,'loyalty_paused')
        if not request.session.session_key:request.session.create()
        key=data.get('idempotency_key',f"{data['target_type']}:{data['target_id']}")
        text(key,'Chave da avaliação',160)
        digest=hashlib.sha256((request.session.session_key+'|'+key).encode()).hexdigest()
        create_review(data,org,digest)
        return response({'ok':True,'message':'Avaliação recebida. Pontos seguem as regras do programa para cadastros elegíveis.'})
    if path.startswith('public/') and request.method=='GET':
        kind=parts[1]
        if kind=='catalog':return response({'benefits':[editorial_json(o) for o in public_query(Benefit)],'events':[editorial_json(o) for o in public_query(Event)],'stores':[{'id':s['id'],'name':s['name']} for s in load_navigation()['stores'] if s.get('unit_type') not in ('facility','structure')],'campaigns':[editorial_json(o) for o in public_query(Content).exclude(kind='ad')],'ads':[editorial_json(o) for o in public_query(Content).filter(kind='ad')]})
        if kind=='ratings':
            data={'target_type':request.GET.get('target_type'),'target_id':request.GET.get('target_id')};target(data)
            items=aggregate(Review.objects.filter(**data));return response({'items':items,'threshold':5})
        models={'events':Event,'content':Content,'benefits':Benefit};require(kind in models,'Recurso não encontrado.',404)
        return response({'items':[editorial_json(o) for o in public_query(models[kind])]})
    who=identity(request)
    if path=='overview' and request.method=='GET':
        result={'role':who['role'],'organizations':Organization.objects.count() if who['role']=='admin' else 1,'events':scope(Event.objects.all(),who).count(),'benefits':scope(Benefit.objects.all(),who).count(),'redemptions':scope(Redemption.objects.all(),who).count(),'members':Member.objects.count() if who['role']=='admin' else None,'points_issued':Ledger.objects.filter(kind='review').aggregate(n=Sum('delta'))['n'] or 0 if who['role']=='admin' else None,'points_redeemed':sum(r.points for r in scope(Redemption.objects.filter(status='redeemed'),who)),'pending_approvals':sum(scope(m.objects.filter(status='pending'),who).count() for m in (Event,Content,Benefit))}
        return response(result)
    if parts[0]=='organizations':
        if request.method=='GET':return response({'items':[organization_json(o) for o in (Organization.objects.all() if who['role']=='admin' else Organization.objects.filter(pk=who['organization_id']))]})
        administrator(who);data=body(request,('name','kind','store_id','active'));pk=int(parts[1]) if len(parts)==2 else None
        require(request.method==('PATCH' if pk else 'POST'),'Método não permitido.',405)
        o=Organization.objects.filter(pk=pk).first() if pk else Organization();require(o is not None,'Organização não encontrada.',404)
        if 'name' in data:o.name=text(data['name'],'Nome',120)
        if 'kind' in data:require(data['kind'] in ('store','producer'),'Tipo inválido.');o.kind=data['kind']
        if 'store_id' in data:
            if data['store_id']:target({'target_type':'store','target_id':data['store_id']})
            require(not Organization.objects.exclude(pk=o.pk).filter(store_id=data['store_id']).exists() or not data['store_id'],'Loja já vinculada.');o.store_id=data['store_id']
        if 'active' in data:require(type(data['active']) is bool,'Estado inválido.');o.active=data['active']
        with transaction.atomic():
            LocationLock.objects.get_or_create(name='__pilot_org_capacity__')
            LocationLock.objects.select_for_update().get(name='__pilot_org_capacity__')
            require(not o.active or Organization.objects.filter(active=True).exclude(pk=o.pk).count()<5,'O piloto comporta até cinco organizações ativas.',409)
            o.full_clean();o.save();audit(request.user,'organization.save',o)
        return response(organization_json(o),200 if pk else 201)
    if parts[0] in ('events','content','benefits'):
        model={'events':Event,'content':Content,'benefits':Benefit}[parts[0]]
        require(len(parts)<=3,'Recurso não encontrado.',404)
        return editorial_edit(model,request,who,int(parts[1]) if len(parts)>1 else None,parts[2] if len(parts)>2 else None)
    if parts[0]=='staff':
        administrator(who)
        if request.method=='GET':
            users=User.objects.all() if request.user.is_superuser else User.objects.filter(is_superuser=False)
            return response({'items':[{'id':u.id,'username':u.username,'active':u.is_active,'role':getattr(getattr(u,'pilot_profile',None),'role','admin' if u.is_superuser else None),'organization_id':getattr(getattr(u,'pilot_profile',None),'organization_id',None)} for u in users]})
        data=body(request,('username','password','role','organization_id','active'))
        with transaction.atomic():
            if len(parts)==1:
                require(request.method=='POST','Método não permitido.',405);role=data.get('role');require(role in ('admin','partner','cashier'),'Perfil inválido.')
                org=Organization.objects.filter(pk=data.get('organization_id'),active=True).first();require(role=='admin' or org is not None,'Organização obrigatória.')
                u=User(username=text(data.get('username'),'Usuário',150));validate_password(data.get('password'),u);u.set_password(data['password']);u.full_clean();u.save();StaffProfile.objects.create(user=u,role=role,organization=org if role!='admin' else None)
            else:
                require(request.method=='PATCH','Método não permitido.',405);u=User.objects.filter(pk=int(parts[1])).first();require(u is not None,'Conta não encontrada.',404)
                require(not u.is_superuser or request.user.is_superuser,'Acesso exclusivo da administração técnica.',403)
                require(u.pk!=request.user.pk or data.get('active',True),'Você não pode desativar a própria conta.')
                if 'active' in data:require(type(data['active']) is bool,'Estado inválido.');u.is_active=data['active']
                if 'password' in data:validate_password(data['password'],u);u.set_password(data['password'])
                u.save()
            audit(request.user,'staff.save',u)
        return response({'id':u.id,'username':u.username,'active':u.is_active})
    if path=='ratings' and request.method=='GET':editor(who);return response({'items':aggregate(scope(Review.objects.all(),who)),'threshold':5})
    if path=='members' and request.method=='GET':administrator(who);return response({'items':[member_json(m) for m in Member.objects.order_by('-id')[:250]]})
    if path=='members/lookup' and request.method=='POST':
        rate_limit(request,'staff_lookup:'+str(request.user.pk),60,3600);data=body(request,('phone',));m=Member.objects.filter(phone=phone(data.get('phone'))).first()
        if m:audit(request.user,'member.lookup',m)
        return response({'member':member_json(m) if m else None})
    if parts[0]=='members' and len(parts)==3:
        administrator(who);pk=int(parts[1]);action=parts[2]
        with transaction.atomic():
            m=Member.objects.select_for_update().filter(pk=pk).first();require(m is not None,'Cadastro não encontrado.',404)
            if action=='activate' and request.method=='POST':
                require(settings.PILOT_OPERATIONS_ENABLED,'Programa temporariamente pausado.',503,'loyalty_paused')
                data=body(request,('confirmed_18',));require(data.get('confirmed_18') is True and m.age_18 and m.status!='closed','Confirme a maioridade declarada.')
                LocationLock.objects.get_or_create(name='__pilot_member_capacity__');LocationLock.objects.select_for_update().get(name='__pilot_member_capacity__')
                require(m.status in ('pending','active') or Member.objects.filter(status__in=('pending','active')).count()<100,'Capacidade de cem participantes atingida.',409)
                m.status='active';m.activated_at=timezone.now();m.activated_by=request.user;m.save();audit(request.user,'member.activated',m);return response(member_json(m))
            if action=='suspend' and request.method=='POST':
                require(m.status!='closed','Cadastro encerrado não pode ser reaberto.',409)
                m.status='suspended';m.save(update_fields=['status']);audit(request.user,'member.suspended',m);return response(member_json(m))
            if action in ('ledger','export') and request.method=='GET':
                entries=list(m.ledger_set.values('id','delta','kind','reason','created_at'));audit(request.user,'member.'+action,m)
                if action=='ledger':return response({'items':entries})
                return response({'member':{**member_json(m),'phone':m.phone,'consent_version':m.consent_version},'ledger':entries,'reviews':list(m.review_set.values('target_type','target_id','score','reason','created_at'))})
            if action=='close' and request.method=='POST':
                data=body(request,('reason','forfeit_balance'));reason=text(data.get('reason'),'Motivo',240)
                if m.status=='closed':return response({'ok':True})
                require(m.balance==0 or data.get('forfeit_balance') is True,'Saldo existente: confirme a renúncia expressa para encerrar.',409)
                if m.balance:Ledger.objects.create(member=m,delta=-m.balance,kind='closure',actor=request.user,reason=reason)
                m.balance=0;m.phone=None;m.first_name='';m.last_name='';m.status='closed';m.closed_at=timezone.now();m.save();audit(request.user,'member.closed',m,reason);return response({'ok':True})
    if path=='redemptions':
        if request.method=='GET':return response({'items':[redemption_json(r) for r in scope(Redemption.objects.all(),who).order_by('-id')[:250]]})
        if request.method=='POST':
            require(settings.PILOT_OPERATIONS_ENABLED,'Resgates temporariamente pausados.',503,'loyalty_paused')
            data=body(request,('member_id','benefit_id','idempotency_key'));r,created=redeem(request.user,who['role'],who['organization_id'],data);return response(redemption_json(r),201 if created else 200)
    if parts[0]=='redemptions' and len(parts)==3 and parts[2]=='reverse' and request.method=='POST':administrator(who);data=body(request,('reason',));return response(redemption_json(reverse(request.user,int(parts[1]),data.get('reason'))))
    raise DomainError('Recurso não encontrado.',404)

def dashboard(request):return render(request,'dashboard.html')
def home(request):return redirect('/participar/')
def local_file(base,name):
    file=(base/name).resolve()
    if not file.is_relative_to(base.resolve()) or not file.is_file():raise Http404
    return FileResponse(file.open('rb'),content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
def public_page(request,page='index.html'):return local_file(settings.BASE_DIR/'public',page)
def public_asset(request,name):return local_file(settings.BASE_DIR/'public',name)
def dashboard_asset(request,name):return local_file(settings.BASE_DIR/'static',name)
def legacy_file(request,name):
    if name=='store-reviews.js':return local_file(settings.BASE_DIR/'integrations','map-store-reviews.js')
    allowed={'explorar.html','explorar.css','explorar.js','map3d.js','map-plan3d.js','brand-logos.js','store-reviews.css','logo-manifest.json','navigation-data.json','map-i18n.js','map-content-i18n.json','vlibras-accessibility.js','vlibras-accessibility.css'}
    require_allowed=name in allowed or (name.startswith(('vendor/','logos/')) and Path(name).suffix in ('.js','.png','.jpg','.jpeg','.webp','.svg'))
    if not require_allowed:raise Http404
    return local_file(settings.LEGACY_DIR/'static',name)
@csrf_exempt
def legacy_navigation(request):
    try:
        if request.method=='GET' and request.path=='/api/navigation':return response(load_navigation())
        if request.method=='POST' and request.path=='/api/routes':return response(calculate_route(body(request,('origin','destination','accessible','map_version'))))
        return response({'error':'Método não permitido.'},405)
    except (DomainError,NavigationError) as e:return response({'error':e.message},e.status)
