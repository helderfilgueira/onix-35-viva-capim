"""Missão experiência: cartões, página do evento (.ics/Google) e pontos por campanha (ver docs/MISSAO_EXPERIENCIA.md)."""
import base64, json, struct, zlib
from datetime import timedelta
from unittest import skipUnless
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, parse_qs
from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from .models import Organization, StaffProfile, Member, Event, Content, Ledger, Audit
from .services import credit_campaign, DomainError, strip_metadata, CAMPAIGN_POINTS
from .calendar import ics_text, fold

PASSWORD = 'A-local-test-password-938!'
TR = {'en': {'title': 'Card EN', 'description': 'Desc EN', 'image_alt': 'Alt EN'}, 'es': {'title': 'Tarjeta ES', 'description': 'Desc ES', 'image_alt': 'Alt ES'}}


def png(extra_chunks=()):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    raw = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
    for t, d in extra_chunks: raw += chunk(t, d)
    return raw + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b'')


def jpeg_with_exif():
    seg = lambda m, d: b'\xff' + bytes([m]) + struct.pack('>H', len(d) + 2) + d
    return b'\xff\xd8' + seg(0xE0, b'JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00') + seg(0xE1, b'Exif\x00\x00GPS-SECRET') + seg(0xFE, b'comentario') + seg(0xDA, b'\x00') + b'\x11\x22' + b'\xff\xd9'


def data_url(kind, raw): return f'data:image/{kind};base64,' + base64.b64encode(raw).decode()


class ExperienceBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.admin = User.objects.create_user('admin', password=PASSWORD); StaffProfile.objects.create(user=cls.admin, role='admin')
        cls.org = Organization.objects.create(name='Loja A', kind='store', store_id='f0-loja-29')
        cls.other = Organization.objects.create(name='Loja B', kind='store', store_id='f1-loja-206')
        cls.partner = User.objects.create_user('partner', password=PASSWORD); StaffProfile.objects.create(user=cls.partner, role='partner', organization=cls.org)
        cls.cashier = User.objects.create_user('cashier', password=PASSWORD); StaffProfile.objects.create(user=cls.cashier, role='cashier', organization=cls.org)
        cls.cashier_other = User.objects.create_user('cashier2', password=PASSWORD); StaffProfile.objects.create(user=cls.cashier_other, role='cashier', organization=cls.other)
        cls.member = Member.objects.create(first_name='Pessoa', last_name='Teste', phone='+5563999990000', status='active', age_18=True, balance=0)
        cls.now = timezone.now()
        cls.event = Event.objects.create(organization=cls.org, title='Show, de; Natal\\ especial', description='Linha 1\nLinha 2', location='Loja 29', store_id='f0-loja-29',
                                         starts=cls.now + timedelta(days=2), ends=cls.now + timedelta(days=2, hours=2), status='approved', translations=TR)
        cls.card = Content.objects.create(organization=cls.org, kind='ad', title='Cartão', description='Descrição', starts=cls.now - timedelta(hours=1), ends=cls.now + timedelta(days=5),
                                          status='approved', translations=TR, event=cls.event, position=2, reward_enabled=True, image_data=data_url('png', png()), image_alt='Alt PT')
        cls.card2 = Content.objects.create(organization=cls.org, kind='ad', title='Outro', starts=cls.now - timedelta(hours=1), ends=cls.now + timedelta(days=5),
                                           status='approved', translations=TR, position=1, reward_enabled=True, store_id='f0-loja-29')

    def api(self, path, body=None, method='post', user=None):
        if user: self.client.force_login(user)
        if method == 'get': return self.client.get('/api/v2/' + path)
        return getattr(self.client, method)('/api/v2/' + path, data=json.dumps(body or {}), content_type='application/json')


class CardsTests(ExperienceBase):
    def test_public_cards_order_locale_and_visibility(self):
        Content.objects.create(organization=self.org, kind='ad', title='Pausado', starts=self.now - timedelta(hours=1), ends=self.now + timedelta(days=1), status='paused', translations=TR)
        Content.objects.create(organization=self.org, kind='ad', title='Expirado', starts=self.now - timedelta(days=3), ends=self.now - timedelta(days=1), status='approved', translations=TR)
        Content.objects.create(organization=self.org, kind='ad', title='Futuro', starts=self.now + timedelta(days=1), ends=self.now + timedelta(days=2), status='approved', translations=TR)
        r = self.client.get('/api/v2/public/cards?locale=es'); self.assertEqual(r.status_code, 200)
        items = r.json()['items']
        self.assertEqual([i['id'] for i in items], [self.card2.id, self.card.id])
        self.assertEqual(items[1]['title'], 'Tarjeta ES'); self.assertEqual(items[1]['image_alt'], 'Alt ES')
        self.assertEqual(items[1]['event']['id'], self.event.id); self.assertEqual(items[1]['place']['id'], 'f0-loja-29')
        self.assertEqual(items[1]['reward_points'], CAMPAIGN_POINTS)
        self.assertNotIn('image_data', json.dumps(items))
        self.assertEqual(self.client.get('/api/v2/public/cards?locale=xx').status_code, 400)

    def test_inactive_org_and_paused_event_hidden(self):
        self.event.status = 'paused'; self.event.save()
        items = self.client.get('/api/v2/public/cards').json()['items']
        self.assertIsNone(next(i for i in items if i['id'] == self.card.id)['event'])
        self.org.active = False; self.org.save()
        self.assertEqual(self.client.get('/api/v2/public/cards').json()['items'], [])

    def test_card_image_served_with_type_and_404_when_not_public(self):
        r = self.client.get(f'/api/v2/public/cards/{self.card.id}/image')
        self.assertEqual(r.status_code, 200); self.assertEqual(r['Content-Type'], 'image/png'); self.assertEqual(r['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(r.content.startswith(b'\x89PNG'))
        self.card.status = 'paused'; self.card.save()
        self.assertEqual(self.client.get(f'/api/v2/public/cards/{self.card.id}/image').status_code, 404)

    def test_upload_rejects_svg_spoofed_and_strips_metadata(self):
        base = {'organization_id': self.org.id, 'title': 'Novo', 'kind': 'ad', 'starts': self.now.isoformat(), 'ends': (self.now + timedelta(days=1)).isoformat()}
        self.assertEqual(self.api('content', {**base, 'image_data': 'data:image/svg+xml;base64,PHN2Zz4='}, user=self.admin).status_code, 400)
        spoof = 'data:image/png;base64,' + base64.b64encode(b'<script>alert(1)</script>').decode()
        self.assertEqual(self.api('content', {**base, 'image_data': spoof}).status_code, 400)
        r = self.api('content', {**base, 'image_data': data_url('jpeg', jpeg_with_exif())}); self.assertEqual(r.status_code, 201)
        stored = base64.b64decode(Content.objects.get(pk=r.json()['id']).image_data.split(',', 1)[1])
        self.assertNotIn(b'GPS-SECRET', stored); self.assertNotIn(b'comentario', stored); self.assertTrue(stored.startswith(b'\xff\xd8') and stored.endswith(b'\xff\xd9'))
        cleaned = strip_metadata('png', png([(b'tEXt', b'Author\x00Fulano'), (b'eXIf', b'GPS')]))
        self.assertNotIn(b'Fulano', cleaned); self.assertNotIn(b'eXIf', cleaned); self.assertIn(b'IEND', cleaned)
        with self.assertRaises(DomainError): strip_metadata('png', png()[:-6])

    def test_location_must_be_catalog_destination_and_event_same_org(self):
        base = {'organization_id': self.org.id, 'title': 'Novo', 'kind': 'ad', 'starts': self.now.isoformat(), 'ends': (self.now + timedelta(days=1)).isoformat()}
        self.assertEqual(self.api('content', {**base, 'store_id': '10.5,20.3'}, user=self.admin).json()['code'], 'invalid_destination')
        other_event = Event.objects.create(organization=self.other, title='E', location='X', starts=self.now, ends=self.now + timedelta(hours=1))
        self.assertEqual(self.api('content', {**base, 'event_id': other_event.id}).status_code, 404)
        r = self.api('content', {**base, 'store_id': 'f0-loja-29', 'event_id': self.event.id, 'position': 3, 'reward_enabled': True}); self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['status'], 'pending'); self.assertFalse(Content.objects.get(pk=r.json()['id']).status == 'approved')
        self.assertEqual(self.api('content', {**base, 'kind': 'easter_egg', 'reward_enabled': True}).status_code, 400)

    def test_permissions_cashier_cannot_edit_partner_cannot_approve_or_touch_other_org(self):
        base = {'organization_id': self.org.id, 'title': 'Novo', 'kind': 'ad', 'starts': self.now.isoformat(), 'ends': (self.now + timedelta(days=1)).isoformat()}
        self.assertEqual(self.api('content', base, user=self.cashier).status_code, 403)
        r = self.api('content', base, user=self.partner); self.assertEqual(r.status_code, 201)
        self.assertEqual(self.api(f"content/{r.json()['id']}/approve", user=self.partner).status_code, 403)
        foreign = Content.objects.create(organization=self.other, kind='ad', title='Alheio', starts=self.now, ends=self.now + timedelta(days=1))
        self.assertEqual(self.client.patch(f'/api/v2/content/{foreign.id}', data=json.dumps({'title': 'X'}), content_type='application/json').status_code, 404)
        self.client.logout(); self.assertEqual(self.api('content', base).status_code, 401)


class EventPageTests(ExperienceBase):
    def test_event_page_google_link_utc_and_no_personal_data(self):
        r = self.client.get(f'/evento/{self.event.id}/'); self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn('Adicionar ao Google Agenda', html); self.assertIn('Abrir a agenda não salva o evento sozinho', html)
        href = html.split('href="https://calendar.google.com')[1].split('"')[0].replace('&amp;', '&')
        q = parse_qs(urlparse('https://calendar.google.com' + href).query)
        self.assertEqual(q['action'], ['TEMPLATE']); self.assertEqual(q['ctz'], ['America/Araguaina'])
        from datetime import timezone as dt_tz
        start = self.event.starts.astimezone(dt_tz.utc).strftime('%Y%m%dT%H%M%SZ')
        self.assertTrue(q['dates'][0].startswith(start + '/') and q['dates'][0].endswith('Z'))
        self.assertNotIn(self.member.phone, html); self.assertNotIn('sessionid', html)
        self.assertIn('Vivara', q['location'][0]); self.assertIn('Shopping Capim Dourado', q['location'][0])
        en = self.client.get(f'/evento/{self.event.id}/?lang=en').content.decode(); self.assertIn('Add to Google Calendar', en); self.assertIn('Card EN', en)

    def test_ics_escaping_utc_and_folding(self):
        r = self.client.get(f'/evento/{self.event.id}.ics'); self.assertEqual(r.status_code, 200)
        self.assertTrue(r['Content-Type'].startswith('text/calendar')); body = r.content.decode()
        self.assertIn('SUMMARY:Show\\, de\\; Natal\\\\ especial', body)
        self.assertIn('DESCRIPTION:Linha 1\\nLinha 2', body.replace('\r\n ', ''))
        self.assertRegex(body, r'DTSTART:\d{8}T\d{6}Z'); self.assertIn('\r\n', body)
        self.assertTrue(all(len(line.encode()) <= 75 for line in body.split('\r\n')))
        self.assertEqual(fold('a' * 160).count('\r\n '), 2); self.assertEqual(ics_text('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne')

    def test_all_day_event_uses_dates_with_exclusive_end(self):
        local = timezone.localtime(self.now).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=3)
        ev = Event.objects.create(organization=self.org, title='Feira', location='Praça', starts=local, ends=local + timedelta(days=1), all_day=True, status='approved', translations=TR)
        body = self.client.get(f'/evento/{ev.id}.ics').content.decode()
        self.assertIn(f'DTSTART;VALUE=DATE:{local:%Y%m%d}', body); self.assertIn(f'DTEND;VALUE=DATE:{local + timedelta(days=1):%Y%m%d}', body)
        html = self.client.get(f'/evento/{ev.id}/').content.decode().replace('&amp;', '&')
        self.assertIn(f'dates={local:%Y%m%d}%2F{local + timedelta(days=1):%Y%m%d}', html); self.assertIn('dia inteiro', html)

    def test_cancelled_ended_and_pending_states(self):
        self.event.status = 'paused'; self.event.save()
        html = self.client.get(f'/evento/{self.event.id}/').content.decode()
        self.assertIn('cancelado ou pausado', html); self.assertNotIn('calendar.google.com', html)
        self.assertEqual(self.client.get(f'/evento/{self.event.id}.ics').status_code, 410)
        old = Event.objects.create(organization=self.org, title='Antigo', location='Y', starts=self.now - timedelta(days=3), ends=self.now - timedelta(days=2), status='approved')
        self.assertIn('já terminou', self.client.get(f'/evento/{old.id}/').content.decode())
        pending = Event.objects.create(organization=self.org, title='Rascunho', location='Z', starts=self.now, ends=self.now + timedelta(hours=1))
        self.assertEqual(self.client.get(f'/evento/{pending.id}/').status_code, 404)
        self.assertEqual(self.client.get('/api/v2/public/events/%d' % pending.id).status_code, 404)


class CampaignTests(ExperienceBase):
    def credit(self, user=None, content=None, member=None, extra=None):
        return self.api('counter/campaign-credit', {'member_id': (member or self.member).id, 'content_id': (content or self.card).id, **(extra or {})}, user=user or self.cashier)

    def test_credit_once_idempotent_and_audited(self):
        r = self.credit(); self.assertEqual(r.status_code, 201); self.assertEqual(r.json()['points'], 5)
        self.assertEqual(self.credit().status_code, 200)
        self.member.refresh_from_db(); self.assertEqual(self.member.balance, 5)
        self.assertEqual(Ledger.objects.filter(kind='campaign').count(), 1)
        self.assertTrue(Audit.objects.filter(action='campaign.credited').exists())

    def test_request_cannot_choose_points(self):
        self.assertEqual(self.credit(extra={'points': 500}).status_code, 400)
        self.member.refresh_from_db(); self.assertEqual(self.member.balance, 0)

    def test_daily_cap_across_campaigns_and_separate_from_reviews(self):
        self.assertEqual(self.credit().status_code, 201)
        r = self.credit(content=self.card2); self.assertEqual(r.status_code, 409); self.assertEqual(r.json()['code'], 'campaign_daily_cap')
        # Avaliações continuam com o próprio teto de 30/dia, independente da campanha.
        from .services import create_review
        create_review({'target_type': 'store', 'target_id': 'f0-loja-29', 'score': 2, 'reason': 'atendimento', 'phone': self.member.phone, 'visited': True, 'consent': True}, self.org, 'k1')
        self.member.refresh_from_db(); self.assertEqual(self.member.balance, 15)

    def test_ineligible_member_campaign_and_scope(self):
        pending = Member.objects.create(first_name='P', last_name='Q', phone='+5563999990001', status='pending', age_18=True)
        self.assertEqual(self.credit(member=pending).status_code, 404)
        for field, value in (('reward_enabled', False), ('status', 'paused'), ('ends', self.now - timedelta(minutes=1))):
            c = Content.objects.get(pk=self.card.pk); setattr(c, field, value); c.save()
            self.assertEqual(self.credit().json()['code'], 'campaign_unavailable', field)
            Content.objects.filter(pk=self.card.pk).update(reward_enabled=True, status='approved', ends=self.now + timedelta(days=5))
        self.assertEqual(self.credit(user=self.cashier_other).status_code, 404)
        self.org.active = False; self.org.save()
        self.assertEqual(self.credit(user=self.admin).json()['code'], 'campaign_unavailable')
        self.assertEqual(Ledger.objects.filter(kind='campaign').count(), 0)

    @override_settings(PILOT_OPERATIONS_ENABLED=False)
    def test_paused_operations_block_credit(self):
        self.assertEqual(self.credit().status_code, 503)

    def test_reversal_admin_only_once_and_not_reopen(self):
        entry = self.credit().json()
        self.assertEqual(self.api(f"campaign-credits/{entry['id']}/reverse", {'reason': 'erro'}, user=self.cashier).status_code, 403)
        self.assertEqual(self.api(f"campaign-credits/{entry['id']}/reverse", {'reason': 'erro'}, user=self.admin).status_code, 201)
        self.assertEqual(self.api(f"campaign-credits/{entry['id']}/reverse", {'reason': 'erro'}).status_code, 200)
        self.member.refresh_from_db(); self.assertEqual(self.member.balance, 0)
        self.assertEqual(self.credit(user=self.cashier).status_code, 200)  # estorno não reabre a campanha
        self.member.refresh_from_db(); self.assertEqual(self.member.balance, 0)

    def test_reversal_refused_when_points_spent(self):
        entry = self.credit().json(); Member.objects.filter(pk=self.member.pk).update(balance=0)
        r = self.api(f"campaign-credits/{entry['id']}/reverse", {'reason': 'erro'}, user=self.admin); self.assertEqual(r.json()['code'], 'campaign_spent')

    def test_counter_list_and_overview(self):
        self.credit()
        items = self.api(f'counter/campaigns?member_id={self.member.id}', method='get').json()['items']
        self.assertEqual({i['id']: i['credited'] for i in items}, {self.card2.id: False, self.card.id: True})
        self.client.force_login(self.admin); o = self.client.get('/api/v2/overview').json()
        self.assertEqual(o['points_campaign'], 5)

    def test_public_text_and_no_phone_on_cards(self):
        body = json.dumps(self.client.get('/api/v2/public/cards').json())
        self.assertNotIn('phone', body); self.assertNotIn('balance', body)


@skipUnless(connection.vendor == 'postgresql', 'Concorrência exige PostgreSQL; SQLite não valida locks de linha.')
class CampaignConcurrencyTests(TransactionTestCase):
    def setUp(self):
        User = get_user_model(); self.actor = User.objects.create_user('op'); StaffProfile.objects.create(user=self.actor, role='admin')
        org = Organization.objects.create(name='Loja', kind='store'); now = timezone.now()
        self.cards = [Content.objects.create(organization=org, kind='ad', title=f'C{i}', starts=now - timedelta(hours=1), ends=now + timedelta(days=1), status='approved', reward_enabled=True) for i in range(2)]
        self.member = Member.objects.create(first_name='A', last_name='B', phone='+5563999997777', age_18=True, status='active')

    def run_pair(self, contents):
        def worker(cid):
            try:
                _, created = credit_campaign(get_user_model().objects.get(pk=self.actor.pk), 'admin', None, {'member_id': self.member.id, 'content_id': cid}); return 'created' if created else 'existing'
            except DomainError as e: return e.code
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool: return sorted(pool.map(worker, contents))

    def test_same_campaign_concurrently_credits_once(self):
        results = self.run_pair([self.cards[0].id, self.cards[0].id])
        self.assertEqual(results, ['created', 'existing']); self.member.refresh_from_db(); self.assertEqual(self.member.balance, 5)
        self.assertEqual(Ledger.objects.filter(kind='campaign').count(), 1)

    def test_daily_cap_holds_for_two_campaigns_concurrently(self):
        results = self.run_pair([self.cards[0].id, self.cards[1].id])
        self.assertEqual(results, ['campaign_daily_cap', 'created']); self.member.refresh_from_db(); self.assertEqual(self.member.balance, 5)


class ReviewFindingsTests(ExperienceBase):
    """Achados da revisão independente de backend (14/11/2026)."""
    def test_never_approved_event_paused_by_partner_does_not_leak_text(self):
        self.client.force_login(self.partner)
        r = self.api('events', {'title': 'GOLPE: ligue 0800', 'description': 'Pix para chave x', 'location': 'Praça X', 'starts': self.now.isoformat(), 'ends': (self.now + timedelta(hours=1)).isoformat()})
        eid = r.json()['id']; self.assertEqual(self.api(f'events/{eid}/pause').status_code, 200)
        page = self.client.get(f'/evento/{eid}/'); self.assertEqual(page.status_code, 410)
        self.assertNotIn('GOLPE', page.content.decode()); self.assertNotIn('Pix', page.content.decode()); self.assertIn('Evento indisponível', page.content.decode())
        api = self.client.get(f'/api/v2/public/events/{eid}').json(); self.assertEqual(api, {'id': eid, 'state': 'cancelled'})

    def test_only_admin_enables_reward(self):
        base = {'organization_id': self.org.id, 'title': 'Novo', 'kind': 'ad', 'starts': self.now.isoformat(), 'ends': (self.now + timedelta(days=1)).isoformat()}
        self.assertEqual(self.api('content', {**base, 'reward_enabled': True}, user=self.partner).status_code, 403)
        cid = self.api('content', {**base, 'reward_enabled': False}).json()['id']
        self.assertEqual(self.client.patch(f'/api/v2/content/{cid}', data=json.dumps({'reward_enabled': True}), content_type='application/json').status_code, 403)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.patch(f'/api/v2/content/{cid}', data=json.dumps({'reward_enabled': True}), content_type='application/json').status_code, 200)
        self.client.force_login(self.partner)  # parceiro edita outro campo mantendo a recompensa já habilitada pelo admin
        self.assertEqual(self.client.patch(f'/api/v2/content/{cid}', data=json.dumps({'title': 'Editado', 'reward_enabled': True}), content_type='application/json').status_code, 200)

    def test_ics_strips_control_and_unicode_separators(self):
        out = ics_text('a\x00b\x0bc\x0cd\u0085e\u2028f\u2029g\th')
        self.assertEqual(out, r'abcde\nf\ng' + '\th')  # separadores viram \n escapado; TAB preservado

    def test_upload_rejects_huge_dimensions_and_drops_jpeg_trailer(self):
        def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        huge = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 60000, 60000, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00')) + chunk(b'IEND', b'')
        with self.assertRaises(DomainError): strip_metadata('png', huge)
        cleaned = strip_metadata('jpeg', jpeg_with_exif() + b'Exif\x00\x00TRAILER-SECRET')
        self.assertNotIn(b'TRAILER-SECRET', cleaned); self.assertTrue(cleaned.endswith(b'\xff\xd9'))

    def test_rollback_guard_blocks_with_campaign_data(self):
        import importlib
        from django.apps import apps
        mig = importlib.import_module('core.migrations.0004_experiencia_cartoes_campanha')
        mig.block_rollback_with_campaign_data(apps, None)  # sem dados: não bloqueia
        self.api('counter/campaign-credit', {'member_id': self.member.id, 'content_id': self.card.id}, user=self.cashier)
        with self.assertRaises(RuntimeError): mig.block_rollback_with_campaign_data(apps, None)
