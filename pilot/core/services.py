import base64, hashlib, ipaddress, os, re, time
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
    clean=strip_metadata(match[1],raw)
    return f'data:image/{match[1]};base64,'+base64.b64encode(clean).decode('ascii')

MAX_SIDE=4000
def strip_metadata(kind,raw):
    """Remove EXIF/XMP/IPTC/comentários sem decodificar pixels; rejeita estrutura malformada."""
    import struct, zlib
    try:
        if kind=='jpeg':
            out=bytearray(raw[:2]);i=2
            while i<len(raw):
                require(raw[i]==0xFF,'Imagem JPEG malformada.')
                marker=raw[i+1]
                if marker==0xD9:out+=raw[i:i+2];break
                if marker==0xDA:
                    # Copia a varredura até o EOI (FFD9) e descarta qualquer dado anexado depois dele.
                    end=raw.find(b'\xff\xd9',i+2);require(end!=-1,'Imagem JPEG malformada.')
                    out+=raw[i:end+2];break
                if marker in (0xC0,0xC1,0xC2) and i+9<len(raw):
                    h_,w_=struct.unpack('>HH',raw[i+5:i+9]);require(0<w_<=MAX_SIDE and 0<h_<=MAX_SIDE,'Imagem muito grande: até 4000×4000 px.')
                if 0xD0<=marker<=0xD7 or marker==0x01:out+=raw[i:i+2];i+=2;continue
                length=struct.unpack('>H',raw[i+2:i+4])[0];require(length>=2,'Imagem JPEG malformada.')
                seg=raw[i:i+2+length];require(len(seg)==2+length,'Imagem JPEG malformada.')
                if marker not in (0xE1,0xED,0xFE):out+=seg  # descarta APP1 (EXIF/XMP), APP13 (IPTC), COM
                i+=2+length
            return bytes(out)
        if kind=='png':
            out=bytearray(raw[:8]);i=8;ended=False
            while i<len(raw):
                length=struct.unpack('>I',raw[i:i+4])[0];ctype=raw[i+4:i+8];chunk=raw[i:i+12+length]
                require(len(chunk)==12+length,'Imagem PNG malformada.')
                require(zlib.crc32(raw[i+4:i+8+length])&0xffffffff==struct.unpack('>I',raw[i+8+length:i+12+length])[0],'Imagem PNG malformada.')
                if ctype==b'IHDR':
                    w_,h_=struct.unpack('>II',raw[i+8:i+16]);require(0<w_<=MAX_SIDE and 0<h_<=MAX_SIDE,'Imagem muito grande: até 4000×4000 px.')
                if ctype not in (b'tEXt',b'iTXt',b'zTXt',b'eXIf',b'tIME'):out+=chunk
                i+=12+length
                if ctype==b'IEND':ended=True;break
            require(ended,'Imagem PNG malformada.')
            return bytes(out)
        if kind=='webp':
            body=bytearray();i=12
            while i<len(raw):
                fourcc=raw[i:i+4];size=struct.unpack('<I',raw[i+4:i+8])[0];padded=size+(size&1)
                chunk=bytearray(raw[i:i+8+padded]);require(len(chunk)>=8+size,'Imagem WebP malformada.')
                if fourcc==b'VP8X':
                    chunk[8]&=~0x0C  # limpa flags de EXIF (0x08) e XMP (0x04)
                    w_=1+int.from_bytes(raw[i+12:i+15],'little');h_=1+int.from_bytes(raw[i+15:i+18],'little')
                    require(w_<=MAX_SIDE and h_<=MAX_SIDE,'Imagem muito grande: até 4000×4000 px.')
                if fourcc not in (b'EXIF',b'XMP '):body+=chunk
                i+=8+padded
            return b'RIFF'+struct.pack('<I',len(body)+4)+b'WEBP'+bytes(body)
    except (IndexError,struct.error):raise DomainError('Imagem malformada.')
    raise DomainError('Formato de imagem inválido.')

def audit(user,action,obj,reason=''):
    Audit.objects.create(actor=user if user and user.is_authenticated else None,action=action,object_type=obj.__class__.__name__,object_id=str(obj.pk),reason=reason)

def client_ip(request):
    source=request.META.get('REMOTE_ADDR','unknown')
    # Vercel overwrites this header at its edge to prevent IP spoofing.
    # https://vercel.com/docs/headers/request-headers#x-forwarded-for
    # Never trust forwarded headers on local or other hosting environments.
    if os.environ.get('VERCEL')=='1':
        forwarded=request.META.get('HTTP_X_FORWARDED_FOR','').strip()
        try:
            # Only a single canonical IPv4/IPv6 address, never a proxy chain.
            if '%' not in forwarded: return str(ipaddress.ip_address(forwarded))
        except ValueError: pass
    return source

def rate_limit(request,scope,limit,seconds):
    source=client_ip(request)
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

# ---------- Campanha de interesse (regra nova, ver docs/MISSAO_EXPERIENCIA.md §2) ----------
# Valor e limites ficam SOMENTE no servidor; o request nunca informa pontos.
CAMPAIGN_POINTS = 5
CAMPAIGN_DAILY_CAP = 5

def campaign_json(entry):
    return {'id':entry.id,'member_id':entry.member_id,'content_id':int(entry.target_id),'points':entry.delta,'created_at':entry.created_at.isoformat()}

def campaign_available(content,now=None):
    now=now or timezone.now()
    return bool(content.kind=='ad' and content.reward_enabled and content.status=='approved' and content.organization.active and content.starts<=now<content.ends)

@transaction.atomic
def credit_campaign(user,role,organization_id,data):
    """Crédito assistido no balcão: o operador confirma, com o membro presente, o interesse na campanha.
    Não é verificação de posse do telefone (o piloto não tem OTP)."""
    from .models import Content
    member_id=integer(data.get('member_id'),'Membro',1);content_id=integer(data.get('content_id'),'Campanha',1)
    # Ordem de travas: membro primeiro (serializa campanhas diferentes do mesmo membro -> teto diário seguro).
    member=Member.objects.select_for_update().filter(pk=member_id).first()
    require(member is not None and member.status=='active','Cadastro ativo não encontrado.',404)
    content=Content.objects.select_related('organization').filter(pk=content_id,kind='ad').first()
    require(content is not None and (role=='admin' or content.organization_id==organization_id),'Campanha não encontrada.',404)
    existing=Ledger.objects.filter(member=member,kind='campaign',target_id=str(content.pk)).first()
    if existing:return existing,False
    now=timezone.now()
    require(campaign_available(content,now),'Campanha sem recompensa ativa neste momento.',409,'campaign_unavailable')
    today=timezone.localdate(now)
    daily=Ledger.objects.filter(member=member,kind='campaign',created_at__date=today).aggregate(total=Sum('delta'))['total'] or 0
    require(daily+CAMPAIGN_POINTS<=CAMPAIGN_DAILY_CAP,'Limite diário de pontos de campanha atingido para este cadastro.',409,'campaign_daily_cap')
    Member.objects.filter(pk=member.pk).update(balance=F('balance')+CAMPAIGN_POINTS)
    entry=Ledger.objects.create(member=member,delta=CAMPAIGN_POINTS,kind='campaign',target_type='campaign',target_id=str(content.pk),actor=user,reason='Interesse confirmado no balcão (assistido; sem verificação de posse do telefone).')
    audit(user,'campaign.credited',entry)
    return entry,True

@transaction.atomic
def reverse_campaign(user,ledger_id,reason):
    reason=text(reason,'Motivo',240)
    snapshot=Ledger.objects.filter(pk=ledger_id,kind='campaign').first();require(snapshot is not None,'Crédito de campanha não encontrado.',404)
    member=Member.objects.select_for_update().get(pk=snapshot.member_id)
    done=Ledger.objects.filter(kind='reversal',target_type='campaign_credit',target_id=str(snapshot.pk)).first()
    if done:return done,False
    require(member.status!='closed','Cadastro encerrado: estorno exige atendimento específico.',409)
    # Pontos já usados não são estornados automaticamente (saldo nunca negativo): análise manual.
    require(member.balance>=snapshot.delta,'Saldo insuficiente: os pontos já foram utilizados. Trate o caso manualmente.',409,'campaign_spent')
    Member.objects.filter(pk=member.pk).update(balance=F('balance')-snapshot.delta)
    entry=Ledger.objects.create(member=member,delta=-snapshot.delta,kind='reversal',target_type='campaign_credit',target_id=str(snapshot.pk),actor=user,reason=reason)
    audit(user,'campaign.reversed',entry,reason)
    return entry,True
