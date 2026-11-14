from django.conf import settings
from django.db import models
from django.db.models import Q

class Organization(models.Model):
    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=16, choices=[('store','Loja'),('producer','Produtor')])
    store_id = models.CharField(max_length=120, blank=True)
    active = models.BooleanField(default=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['store_id'],condition=~Q(store_id=''),name='organization_unique_mapped_store')]
    def __str__(self): return self.name

class StaffProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL,on_delete=models.CASCADE,related_name='pilot_profile')
    role = models.CharField(max_length=12,choices=[('admin','Administrador'),('partner','Parceiro'),('cashier','Balcão')])
    organization = models.ForeignKey(Organization,on_delete=models.PROTECT,null=True,blank=True)
    def __str__(self): return f'{self.user.username} / {self.role}'

class Editorial(models.Model):
    organization = models.ForeignKey(Organization,on_delete=models.PROTECT)
    title = models.CharField(max_length=120)
    description = models.TextField(max_length=2000,blank=True)
    translations = models.JSONField(default=dict,blank=True)
    status = models.CharField(max_length=12,default='pending',choices=[('pending','Pendente'),('approved','Aprovado'),('paused','Pausado')])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Meta: abstract = True
    def __str__(self): return self.title

class Event(Editorial):
    location = models.CharField(max_length=120)
    # Destino do catálogo do mapa (navigation-data.json), validado no servidor; nunca coordenada livre.
    store_id = models.CharField(max_length=120, blank=True)
    all_day = models.BooleanField(default=False)
    starts = models.DateTimeField()
    ends = models.DateTimeField()

class Content(Editorial):
    kind = models.CharField(max_length=16,choices=[('ad','Anúncio'),('campaign','Campanha'),('easter_egg','Descoberta')])
    theme = models.CharField(max_length=40,blank=True)
    starts = models.DateTimeField()
    ends = models.DateTimeField()
    image_data = models.TextField(blank=True)
    image_alt = models.CharField(max_length=240,blank=True)
    target_url = models.URLField(blank=True)
    discoveries = models.JSONField(default=list,blank=True)
    # Cartão de anúncio (kind='ad'): starts/ends acima são a vigência de EXIBIÇÃO; o evento tem datas próprias.
    event = models.ForeignKey(Event,null=True,blank=True,on_delete=models.SET_NULL,related_name='cards')
    store_id = models.CharField(max_length=120, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    # Recompensa de campanha: desativada por padrão; valor e limites ficam no servidor (services.CAMPAIGN_POINTS).
    reward_enabled = models.BooleanField(default=False)

class Benefit(Editorial):
    points_cost = models.PositiveIntegerField()
    stock = models.PositiveIntegerField(default=0)
    starts = models.DateTimeField(null=True,blank=True)
    ends = models.DateTimeField(null=True,blank=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(points_cost__gte=1),name='benefit_positive_cost')]

class Member(models.Model):
    first_name = models.CharField(max_length=80)
    last_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=16,unique=True,null=True)
    phone_verified = models.BooleanField(default=False,editable=False)
    status = models.CharField(max_length=12,default='pending',choices=[('pending','Pendente'),('active','Ativo'),('suspended','Suspenso'),('closed','Encerrado')])
    age_18 = models.BooleanField()
    consent_version = models.CharField(max_length=40,default='loyalty-pilot-v1')
    locale = models.CharField(max_length=5,default='pt-BR')
    balance = models.PositiveIntegerField(default=0,editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    activated_at = models.DateTimeField(null=True,blank=True)
    activated_by = models.ForeignKey(settings.AUTH_USER_MODEL,null=True,blank=True,on_delete=models.SET_NULL)
    closed_at = models.DateTimeField(null=True,blank=True)

class Review(models.Model):
    submission_key = models.CharField(max_length=64,unique=True,null=True,blank=True)
    target_type = models.CharField(max_length=5,choices=[('store','Loja'),('event','Evento')])
    target_id = models.CharField(max_length=120)
    organization = models.ForeignKey(Organization,on_delete=models.PROTECT,null=True)
    score = models.PositiveSmallIntegerField()
    reason = models.CharField(max_length=32)
    member = models.ForeignKey(Member,on_delete=models.SET_NULL,null=True,blank=True)
    rewarded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.CheckConstraint(condition=Q(score__gte=1)&Q(score__lte=5),name='review_score_range')]
        indexes = [models.Index(fields=['member','target_type','target_id','created_at'])]

class Redemption(models.Model):
    member = models.ForeignKey(Member,on_delete=models.PROTECT)
    benefit = models.ForeignKey(Benefit,on_delete=models.PROTECT)
    organization = models.ForeignKey(Organization,on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.PROTECT)
    idempotency_key = models.CharField(max_length=80)
    points = models.PositiveIntegerField()
    title = models.CharField(max_length=120)
    status = models.CharField(max_length=12,default='redeemed',choices=[('redeemed','Entregue'),('reversed','Estornado')])
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [models.UniqueConstraint(fields=['actor','idempotency_key'],name='redemption_actor_key')]

class Ledger(models.Model):
    member = models.ForeignKey(Member,on_delete=models.PROTECT)
    delta = models.IntegerField()
    kind = models.CharField(max_length=16,choices=[('review','Avaliação'),('campaign','Campanha'),('redemption','Resgate'),('reversal','Estorno'),('closure','Encerramento')])
    target_type = models.CharField(max_length=16,blank=True)
    target_id = models.CharField(max_length=120,blank=True)
    review = models.OneToOneField(Review,on_delete=models.SET_NULL,null=True,blank=True)
    redemption = models.ForeignKey(Redemption,on_delete=models.PROTECT,null=True,blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True,blank=True)
    reason = models.CharField(max_length=240,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['redemption','kind'],name='one_redemption_ledger_kind'),
            # Uma concessão por membro e campanha (target_id = Content.pk), inclusive após estorno.
            models.UniqueConstraint(fields=['member','target_id'],condition=Q(kind='campaign'),name='one_campaign_credit_per_member'),
            # Um estorno por crédito de campanha (target_id = Ledger.pk do crédito).
            models.UniqueConstraint(fields=['target_id'],condition=Q(kind='reversal',target_type='campaign_credit'),name='one_reversal_per_campaign_credit'),
        ]

class Audit(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL,on_delete=models.SET_NULL,null=True)
    action = models.CharField(max_length=60)
    object_type = models.CharField(max_length=40)
    object_id = models.CharField(max_length=120)
    reason = models.CharField(max_length=240,blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

class RateBucket(models.Model):
    key = models.CharField(max_length=64,primary_key=True)
    window = models.BigIntegerField()
    count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

class LocationLock(models.Model):
    name = models.CharField(max_length=120,primary_key=True)
