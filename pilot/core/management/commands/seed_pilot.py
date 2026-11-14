import os
from datetime import timedelta
from django.core.management.base import BaseCommand,CommandError
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone
from core.models import Organization,StaffProfile,Event,Benefit,Content

class Command(BaseCommand):
    help='Cria dados demonstrativos e conta admin via PILOT_ADMIN_PASSWORD; nunca imprime senha.'
    @transaction.atomic
    def handle(self,*args,**options):
        password=os.environ.get('PILOT_ADMIN_PASSWORD','')
        if not password:raise CommandError('Defina PILOT_ADMIN_PASSWORD para criar a conta inicial.')
        username=os.environ.get('PILOT_ADMIN_USERNAME','onix-admin');User=get_user_model()
        user,created=User.objects.get_or_create(username=username)
        if created:validate_password(password,user);user.set_password(password);user.is_staff=True;user.is_superuser=True;user.save()
        StaffProfile.objects.get_or_create(user=user,defaults={'role':'admin'})
        shop,_=Organization.objects.get_or_create(store_id='f0-loja-29',defaults={'name':'Vivara · demonstração','kind':'store'})
        producer,_=Organization.objects.get_or_create(name='Experiências Onix · demonstração',defaults={'kind':'producer'})
        now=timezone.now();translations={'en':{'title':'Sample experience','description':'Fictional pilot content.'},'es':{'title':'Experiencia de ejemplo','description':'Contenido ficticio del piloto.'}}
        Event.objects.get_or_create(title='Encontro de Natal · demonstração',organization=producer,defaults={'description':'Evento fictício para testar o programa.','location':'Praça A','starts':now-timedelta(hours=1),'ends':now+timedelta(days=30),'status':'approved','translations':translations})
        Benefit.objects.get_or_create(title='Benefício de demonstração',organization=shop,defaults={'description':'Sem valor comercial; teste do resgate presencial.','points_cost':10,'stock':100,'starts':now-timedelta(days=1),'ends':now+timedelta(days=30),'status':'approved','translations':translations})
        discoveries=[{'id':str(i),'title':f'Descoberta {i}','translations':{'en':{'title':f'Discovery {i}'},'es':{'title':f'Descubrimiento {i}'}}} for i in (1,2,3)]
        Content.objects.get_or_create(title='Natal de descobertas',organization=producer,defaults={'description':'Encontre três surpresas digitais. Não concede pontos.','kind':'campaign','theme':'christmas','starts':now-timedelta(days=1),'ends':now+timedelta(days=30),'status':'approved','translations':translations,'discoveries':discoveries})
        self.stdout.write('Dados demonstrativos preparados. Senhas existentes não foram alteradas.')
