from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from .middleware import PilotHeaders


class AccessibilityHeaderTests(SimpleTestCase):
    def test_translator_sources_are_limited_to_public_map_and_catalogue(self):
        middleware = PilotHeaders(lambda request: HttpResponse('ok'))
        for path in ('/participar/', '/explorar.html?destination=f0-loja-29'):
            response = middleware(RequestFactory().get(path))
            self.assertIn('https://vlibras.gov.br', response['Content-Security-Policy'])
        for path in ('/participar/cadastro/', '/participar/avaliar/', '/dashboard/', '/admin/', '/api/v2/members', '/public/join.html'):
            response = middleware(RequestFactory().get(path))
            self.assertNotIn('vlibras', response['Content-Security-Policy'])
            self.assertNotIn('cdn.jsdelivr.net', response['Content-Security-Policy'])
