import base64, hashlib, re, time
from datetime import timedelta
from urllib.parse import urlparse
from django.conf import settings
from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import Organization, Member, Review, Benefit, Redemption, Ledger, Audit, RateBucket, LocationLock

class DomainError(Exception):
    def __init__(self,message,status=400,code='invalid'):
        self.message,self.status,self.code=message,status,code

def require(condition,message,status=400,code='invalid'):
    if not condition: raise DomainError(message,status,code)

def text(value,field,limit,required=True):
    require(isinstance(value,str),f'{field}: texto inválido.')
    value=value.strip()
    require((bool(value) or not required) and len(value)<=limit,f'{field}: tamanho inválido.')
    return value

def integer(value,field,minimum=0,maximum=1000000):
    require(type(value) is int and minimum<=value<=maximum,f'{field}: número inteiro inválido.')
    return value

def phone(value):
    require(isinstance(value,str) and len(value)<=30,'Telefone inválido.')
    digits=re.sub(r'[^0-9]','',value)
    if len(digits) in (10,11) and not value.startswith('+'):digits='55'+digits
    require(10<=len(digits)<=15,'Telefone inválido.')
    return '+'+digits

def datetime_value(value):
    d=parse_datetime(value) if isinstance(value,str) else None
    require(d is not None and timezone.is_aware(d),'Informe data ISO com fuso horário.')
    return d

def translations(value):
    require(isinstance(value,dict) and not set(value)-{'en','es'},'Traduções inválidas.')
    result={}
    for lang,fields in value.items():
        require(isinstance(fields,dict) and not set(fields)-{'title','description','image_alt'},'Campos de tradução inválidos.')
        result[lang]={k:text(v,k,2000,False) for k,v in fields.items()}
    return result

def verify_publish(obj):
    for lang in ('en','es'):
        fields=obj.translations.get(lang,{})
        require(bool(fields.get('title')) and (not obj.description or bool(fields.get('description'))),'Adicione título e descrição em inglês e espanhol antes de aprovar.')
    if hasattr(obj,'starts'):
        require(obj.starts and obj.ends and obj.ends>obj.starts,'Defina validade de início e fim.')
        require(obj.ends>timezone.now(),'O período já terminou.')
    if getattr(obj,'image_data',''):
        require(obj.image_alt and all(obj.translations.get(l,{}).get('image_alt') for l in ('en','es')),'Imagem exige texto alternativo nos três idiomas.')
    if getattr(obj,'kind','') in ('campaign','easter_egg'):
        require(len(obj.discoveries)==3,'Campanha exige três descobertas.')
        for item in obj.discoveries:
            require(all(item.get('translations',{}).get(l,{}).get('title') for l in ('en','es')),'Traduza as três descobertas.')

def image(value):
    if value=='':return ''
    require(isinstance(value,str) and len(value)<=420000,'Imagem excede 300KB.')
    match=re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)',value)
    require(match is not None,'Use imagem PNG, JPEG ou WebP em data URL.')
    try: raw=base64.b64decode(match[2],validate=True)
    except ValueError:raise DomainError('Imagem inválida.')
    valid=(match[1]=='png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1]=='jpeg' and raw.startswith(b'\xff\xd8\xff')) or (match[1]=='webp' and raw.startswith(b'RIFF') and raw[8:12]==b'WEBP')
    require(valid and len(raw)<=307200,'Imagem inválida ou excede 300KB.')
    return value

def audit(user,action,obj,reason=''):
    Audit.objects.create(actor=user if user and user.is_authenticated else None,action=action,object_type=obj.__class__.__name__,object_id=str(obj.pk),reason=reason)

def rate_limit(request,scope,limit,seconds):
    # Direct peer only. Do not trust a client-supplied X-Forwarded-For header.
    source=request.META.get('REMOTE_ADDR','unknown')
    key=hashlib.sha256((settings.SECRET_KEY+'|'+scope+'|'+source).encode()).hexdigest()
    window=int(time.time())//seconds
    with transaction.atomic():
        bucket,_=RateBucket.objects.get_or_create(key=key,defaults={'window':window,'count':0})
        bucket=RateBucket.objects.select_for_update().get(pk=key)
        if bucket.window!=window:bucket.window=window;bucket.count=0
        require(bucket.count<limit,'Muitas tentativas. Aguarde e tente novamente.',429,'rate_limited')
        bucket.count+=1;bucket.save(update_fields=['window','count','updated_at'])

def member_json(m,include_phone=False):
    return {'id':m.id,'first_name':m.first_name,'last_name':m.last_name,'phone_masked':('***'+m.phone[-4:]) if m.phone else '', 'status':m.status,'balance':m.balance,'created_at':m.created_at.isoformat(),'phone_verified':False}

@transaction.atomic
def register(data):
    require(data.get('age_18') is True and data.get('consent') is True,'Cadastro opcional exclusivo para maiores de 18 anos com aceite.')
    first=text(data.get('first_name'),'Nome',80);last=text(data.get('last_name'),'Sobrenome',120);p=phone(data.get('phone'))
    locale=data.get('locale','pt-BR');require(locale in ('pt-BR','en','es'),'Idioma inválido.')
    LocationLock.objects.get_or_create(name='__pilot_member_capacity__')
    LocationLock.objects.select_for_update().get(name='__pilot_member_capacity__')
    if not Member.objects.filter(phone=p).exists():
        # Same public reply when capacity is exhausted; never reveal membership by phone.
        if Member.objects.filter(status__in=('pending','active')).count()>=100:return
        Member.objects.create(phone=p,first_name=first,last_name=last,age_18=True,locale=locale)

@transaction.atomic
def create_review(data,target_org,submission_key):
    require(data.get('consent') is True and data.get('visited') is True,'Confirme o aceite e a visita autodeclarada.')
    score=integer(data.get('score'),'Nota',1,5)
    reason=data.get('reason');require(reason in ('atendimento','produtos','ambiente','acessibilidade','outro','programacao','localizacao','organizacao'),'Aspecto inválido.')
    member=None
    if data.get('phone'):
        p=phone(data['phone']);member=Member.objects.select_for_update().filter(phone=p,status='active').first()
    now=timezone.now();eligible=False
    if Review.objects.filter(submission_key=submission_key).exists():return None
    if member:
        previous=Review.objects.filter(member=member,target_type=data['target_type'],target_id=str(data['target_id']))
        if data['target_type']=='store':previous=previous.filter(created_at__gte=now-timedelta(days=30))
        if previous.exists():return None
        old=Ledger.objects.filter(member=member,kind='review',target_type=data['target_type'],target_id=str(data['target_id']))
        if data['target_type']=='store':old=old.filter(created_at__gte=now-timedelta(days=30))
        today=timezone.localdate(now)
        daily=Ledger.objects.filter(member=member,kind='review',created_at__date=today).aggregate(total=Sum('delta'))['total'] or 0
        if old.exists():return None
        eligible=daily+10<=30
    review=Review.objects.create(submission_key=submission_key,target_type=data['target_type'],target_id=str(data['target_id']),organization=target_org,score=score,reason=reason,member=member,rewarded=eligible)
    if eligible:
        Member.objects.filter(pk=member.pk).update(balance=F('balance')+10)
        Ledger.objects.create(member=member,delta=10,kind='review',review=review,target_type=data['target_type'],target_id=str(data['target_id']),reason='Participação; mesma pontuação para qualquer nota.')
    return review

def redemption_json(r):
    return {'id':r.id,'member_id':r.member_id,'benefit_id':r.benefit_id,'organization_id':r.organization_id,'title':r.title,'points':r.points,'status':r.status,'created_at':r.created_at.isoformat()}

@transaction.atomic
def redeem(user,role,organization_id,data):
    member_id=integer(data.get('member_id'),'Membro',1);benefit_id=integer(data.get('benefit_id'),'Benefício',1)
    key=text(data.get('idempotency_key'),'Chave de operação',80)
    existing=Redemption.objects.filter(actor=user,idempotency_key=key).first()
    if existing:
        require(role=='admin' or existing.organization_id==organization_id,'Resgate não encontrado.',404)
        require(existing.member_id==member_id and existing.benefit_id==benefit_id,'Chave já usada em outra operação.',409)
        return existing,False
    member=Member.objects.select_for_update().filter(pk=member_id).first()
    require(member is not None and member.status=='active','Cadastro ativo não encontrado.',404)
    benefit=Benefit.objects.select_for_update().filter(pk=benefit_id).first()
    require(benefit is not None and (role=='admin' or benefit.organization_id==organization_id),'Benefício não encontrado.',404)
    # Recheck after acquiring row lock: a concurrent identical request may have completed.
    existing=Redemption.objects.filter(actor=user,idempotency_key=key).first()
    if existing:
        require(role=='admin' or existing.organization_id==organization_id,'Resgate não encontrado.',404)
        require(existing.member_id==member_id and existing.benefit_id==benefit_id,'Chave já usada em outra operação.',409)
        return existing,False
    now=timezone.now()
    require(benefit.status=='approved' and benefit.organization.active and benefit.starts and benefit.ends and benefit.starts<=now<benefit.ends,'Benefício não está disponível.',409)
    require(benefit.stock>0,'Benefício sem estoque.',409)
    require(member.balance>=benefit.points_cost,'Saldo insuficiente.',409)
    Member.objects.filter(pk=member.pk).update(balance=F('balance')-benefit.points_cost)
    Benefit.objects.filter(pk=benefit.pk).update(stock=F('stock')-1)
    r=Redemption.objects.create(member=member,benefit=benefit,organization=benefit.organization,actor=user,idempotency_key=key,points=benefit.points_cost,title=benefit.title)
    Ledger.objects.create(member=member,delta=-r.points,kind='redemption',redemption=r,actor=user)
    audit(user,'redemption.delivered',r)
    return r,True

@transaction.atomic
def reverse(user,rid,reason):
    reason=text(reason,'Motivo',240)
    # Consistent member -> benefit -> redemption locking order.
    snapshot=Redemption.objects.filter(pk=rid).first();require(snapshot is not None,'Resgate não encontrado.',404)
    member=Member.objects.select_for_update().get(pk=snapshot.member_id)
    benefit=Benefit.objects.select_for_update().get(pk=snapshot.benefit_id)
    r=Redemption.objects.select_for_update().get(pk=rid)
    if r.status=='reversed':return r
    require(member.status!='closed','Cadastro encerrado: estorno exige atendimento específico.',409)
    Member.objects.filter(pk=member.pk).update(balance=F('balance')+r.points)
    Benefit.objects.filter(pk=benefit.pk).update(stock=F('stock')+1)
    Ledger.objects.create(member=member,delta=r.points,kind='reversal',redemption=r,actor=user,reason=reason)
    r.status='reversed';r.save(update_fields=['status']);audit(user,'redemption.reversed',r,reason)
    return r
