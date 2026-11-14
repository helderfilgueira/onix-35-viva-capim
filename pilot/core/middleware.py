class PilotHeaders:
    def __init__(self,get_response): self.get_response=get_response
    def __call__(self,request):
        response=self.get_response(request)
        response['Cache-Control']='no-store'
        # Only the public catalogue can opt into VLibras. Identity and staff pages never load third parties.
        vlibras = request.path == '/participar/'
        external = ' https://vlibras.gov.br https://*.vlibras.gov.br' if vlibras else ''
        script_cdn = ' https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/' if vlibras else ''
        fonts = ' https://vlibras.gov.br/app/assets/fonts/'+script_cdn if vlibras else ''
        response['Content-Security-Policy'] = "default-src 'self'; script-src 'self'"+external+script_cdn+"; style-src 'self' 'unsafe-inline'"+external+"; img-src 'self' data: blob:"+external+script_cdn+"; font-src 'self'"+fonts+"; connect-src 'self'"+external+"; media-src 'self' blob:"+external+"; frame-src 'self'"+external+"; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response
