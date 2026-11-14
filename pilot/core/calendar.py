"""Página pública do evento: link do Google Agenda e arquivo .ics (RFC 5545).

O link `calendar.google.com/calendar/render?action=TEMPLATE` não tem documentação oficial pública
do Google; os parâmetros (text, dates, details, location, ctz) são documentados por terceiros. Por
isso os horários vão em UTC com sufixo Z (sem ambiguidade) e o .ics é a alternativa interoperável.
Nenhum dado pessoal entra em URL ou arquivo: apenas dados públicos do evento.
"""
from datetime import timedelta, timezone as dt_timezone
from urllib.parse import urlencode
from django.utils import timezone

TZ_NAME = 'America/Araguaina'


def utc_stamp(value):
    return value.astimezone(dt_timezone.utc).strftime('%Y%m%dT%H%M%SZ')


def all_day_range(event):
    """Datas locais [início, fim) de evento de dia inteiro; fim exclusivo (RFC 5545 e Google)."""
    start = timezone.localtime(event.starts).date()
    end_local = timezone.localtime(event.ends)
    midnight = (end_local.hour, end_local.minute, end_local.second) == (0, 0, 0)
    end = end_local.date() if midnight else end_local.date() + timedelta(days=1)
    if end <= start:
        end = start + timedelta(days=1)
    return start, end


def google_url(event, title, details, location, page_url):
    if event.all_day:
        a, b = all_day_range(event)
        dates = f"{a:%Y%m%d}/{b:%Y%m%d}"
    else:
        dates = f"{utc_stamp(event.starts)}/{utc_stamp(event.ends)}"
    body = (details + '\n\n' if details else '') + page_url
    return 'https://calendar.google.com/calendar/render?' + urlencode(
        {'action': 'TEMPLATE', 'text': title, 'dates': dates, 'details': body, 'location': location, 'ctz': TZ_NAME})


def ics_text(value):
    """RFC 5545 §3.3.11: escapa barra invertida, ponto e vírgula, vírgula e quebras de linha.
    Remove caracteres de controle (Cc, exceto TAB) e separadores Unicode de linha/parágrafo (Zl, Zp)."""
    import unicodedata
    value = value.replace('\r\n', '\n').replace('\r', '\n').replace('\u2028', '\n').replace('\u2029', '\n')
    value = ''.join(ch for ch in value if ch in '\n\t' or unicodedata.category(ch) not in ('Cc', 'Zl', 'Zp'))
    value = value.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,')
    return value.replace('\n', '\\n')


def fold(line):
    """RFC 5545 §3.1: linhas de até 75 octetos; continuação inicia com um espaço."""
    parts, chunk, limit = [], b'', 75
    for ch in line:
        encoded = ch.encode('utf-8')
        if len(chunk) + len(encoded) > limit:
            parts.append(chunk)
            chunk, limit = b'', 74
        chunk += encoded
    parts.append(chunk)
    return '\r\n '.join(part.decode('utf-8') for part in parts)


def ics_document(event, title, details, location, page_url, host):
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Viva Capim//Piloto Onix 35//PT-BR', 'CALSCALE:GREGORIAN',
             'METHOD:PUBLISH', 'BEGIN:VEVENT', f'UID:viva-capim-evento-{event.pk}@{host}', f'DTSTAMP:{utc_stamp(timezone.now())}']
    if event.all_day:
        a, b = all_day_range(event)
        lines += [f'DTSTART;VALUE=DATE:{a:%Y%m%d}', f'DTEND;VALUE=DATE:{b:%Y%m%d}']
    else:
        lines += [f'DTSTART:{utc_stamp(event.starts)}', f'DTEND:{utc_stamp(event.ends)}']
    body = (details + '\n\n' if details else '') + page_url
    lines += ['SUMMARY:' + ics_text(title), 'DESCRIPTION:' + ics_text(body), 'LOCATION:' + ics_text(location),
              'URL:' + page_url, 'STATUS:' + ('CONFIRMED' if event.status == 'approved' else 'CANCELLED'),
              'END:VEVENT', 'END:VCALENDAR']
    return '\r\n'.join(fold(line) for line in lines) + '\r\n'
