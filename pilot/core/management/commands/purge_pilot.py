from datetime import timedelta
import time
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from core.models import Member,Review,Ledger,Redemption,RateBucket,Audit

class Command(BaseCommand):
    help='Aplica retenção: avaliações 30 dias, pendentes 30 dias, encerrados/extrato 180 dias.'
    def handle(self,*args,**options):
        now=timezone.now()
        with transaction.atomic():
            review_count,_=Review.objects.filter(created_at__lt=now-timedelta(days=30)).delete()
            pending=Member.objects.filter(status='pending',created_at__lt=now-timedelta(days=30))
            pending_count=pending.count();pending.delete()
            closed=Member.objects.filter(status='closed',closed_at__lt=now-timedelta(days=180))
            ids=list(closed.values_list('id',flat=True));Ledger.objects.filter(member_id__in=ids).delete();Redemption.objects.filter(member_id__in=ids).delete();Review.objects.filter(member_id__in=ids).delete();closed.delete()
            Audit.objects.filter(created_at__lt=now-timedelta(days=180)).delete()
            RateBucket.objects.filter(updated_at__lt=now-timedelta(days=2)).delete()
        self.stdout.write(f'Retenção aplicada: {review_count} avaliações, {pending_count} pendentes, {len(ids)} encerrados.')
