"""Publish one approved Supabase request to its canonical GeoJSON record.

Runs on a trusted GitHub Actions runner. No external Python dependencies.
"""
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

def normalize_supabase_base(raw):
    """Accept a Supabase project URL, optionally ending in /rest/v1."""
    value = raw.strip().rstrip('/')
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('SUPABASE_URL must be an HTTPS Supabase project URL without query parameters')
    if not parsed.hostname.endswith('.supabase.co'):
        raise ValueError('SUPABASE_URL must be the project URL (https://<project-ref>.supabase.co), not the dashboard URL')
    path = parsed.path.rstrip('/')
    if path == '/rest/v1':
        path = ''
    if path:
        raise ValueError('SUPABASE_URL must not contain a path other than an optional /rest/v1 suffix')
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))


BASE = normalize_supabase_base(os.environ['SUPABASE_URL'])
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
REQUEST_ID = os.environ['REQUEST_ID']
BRANCH = 'feature/site-updates'
FILES = {
    ('telus', 'BC'): 'data/BC_TELUS.geojson',
    ('telus', 'AB'): 'data/AB_TELUS.geojson',
    ('telus', 'SK'): 'data/SK_TELUS.geojson',
    ('rogers', 'BC'): 'data/BC_Rogers.geojson',
    ('rogers', 'AB'): 'data/AB_Rogers.geojson',
}
FIELDS = {'Site Address', 'Site Info / Notes', 'Useful Contact Info', 'Site Special Instructions'}
HEADINGS = ['Site Address', 'Site Info / Notes', 'Useful Contact Info', 'Site Special Instructions', 'GPS Coordinates']


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def rest(method, table, query='', payload=None):
    url = f'{BASE}/rest/v1/{table}{query}'
    headers = {'apikey': KEY, 'Accept': 'application/json'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
        headers['Prefer'] = 'return=representation'
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read() or b'null')
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'Supabase HTTP {exc.code} on {method} /rest/v1/{table}: {exc.read(500).decode(errors="replace")}') from exc


def load_request():
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', REQUEST_ID):
        raise ValueError('Invalid request UUID')
    q = '?' + urllib.parse.urlencode({'id': f'eq.{REQUEST_ID}', 'select': 'id,carrier,province,site_code,field_name,action,original_value,proposed_value,status,published_at'})
    rows = rest('GET', 'site_update_requests', q)
    if len(rows) != 1:
        raise ValueError('Request not found')
    return rows[0]


def update_description(props, field):
    desc = str(props.get('description') or '')
    value = str(props.get(field) or '')
    heading = f'**{field}**'
    start = desc.find(heading)
    if start < 0:
        gps = desc.find('**GPS Coordinates**')
        section = f'{heading}\n\n{value}\n\n'
        props['description'] = (desc.rstrip() + '\n\n' + section.rstrip()) if gps < 0 else (desc[:gps].rstrip() + '\n\n' + section + desc[gps:])
        return
    content_start = start + len(heading)
    remaining = desc[content_start:]
    offsets = [remaining.find(f'**{h}**') for h in HEADINGS if h != field]
    offsets = [n for n in offsets if n >= 0]
    end = content_start + min(offsets) if offsets else len(desc)
    props['description'] = (desc[:content_start] + '\n\n' + value + '\n\n' + desc[end:].lstrip()).rstrip()


def change_contact_line(current, action, original, proposed):
    """Change exactly one blank-line-delimited contact block, never a substring.

    Legacy content without blank-line delimiters remains one block. Existing
    formatting is preserved outside the selected block.
    """
    import re

    def blocks(text):
        # Retain original byte offsets so unrelated contact text is untouched.
        return [(m.start(), m.end(), m.group()) for m in
                re.finditer(r'[^\r\n](?:[^\r\n]|\r?\n(?![ \t]*\r?\n))*', text)]

    if action == 'add':
        if proposed is None or not str(proposed).strip():
            raise ValueError('Invalid contact addition')
        new = str(proposed).strip()
        if any(block.strip() == new for _, _, block in blocks(current)):
            raise ValueError('Contact already exists; review required')
        if not current.strip():
            return new
        return current.rstrip('\r\n') + '\n\n' + new

    if original is None or not str(original).strip():
        raise ValueError('Missing original contact')
    old = str(original).strip()
    matches = [(start, end) for start, end, block in blocks(current)
               if block.strip() == old]
    if len(matches) != 1:
        raise ValueError('Stale or ambiguous contact: expected exactly one matching contact block')
    start, end = matches[0]
    if action == 'replace':
        if proposed is None or not str(proposed).strip():
            raise ValueError('Invalid contact replacement')
        new = str(proposed).strip()
        if new == old:
            raise ValueError('No effective change')
        if any(block.strip() == new for _, _, block in blocks(current)):
            raise ValueError('Replacement contact already exists')
        return current[:start] + new + current[end:]
    if action == 'remove':
        # Remove adjacent blank separator, not another contact's content.
        after = current[end:]
        before = current[:start]
        if after.strip():
            after = re.sub(r'^(?:[ \t]*\r?\n)+', '', after)
            return before + after
        before = re.sub(r'(?:\r?\n[ \t]*)+$', '', before)
        return before
    raise ValueError('Unsupported contact action')


def apply(props, row):
    field, action = row['field_name'], row['action']
    if field not in FIELDS or action not in {'add', 'replace', 'remove'}:
        raise ValueError('Unsupported field/action')
    current = str(props.get(field) or '')
    original = row['original_value']
    proposed = row['proposed_value']
    if field == 'Useful Contact Info':
        next_value = change_contact_line(current, action, original, proposed)
    elif action == 'replace':
        if original is None or proposed is None or not str(proposed).strip():
            raise ValueError('Invalid replacement')
        if current != str(original):
            raise ValueError('Stale replacement: field differs from original snapshot')
        next_value = str(proposed)
    elif action == 'add':
        if proposed is None or not str(proposed).strip():
            raise ValueError('Invalid addition')
        if current.strip():
            raise ValueError('Field changed since submission')
        next_value = str(proposed)
    else:
        if original is None or not str(original).strip():
            raise ValueError('Invalid removal')
        if current != str(original):
            raise ValueError('Stale removal: field differs from original snapshot')
        next_value = ''
    if current == next_value:
        raise ValueError('No effective change; review required')
    props[field] = next_value
    update_description(props, field)


def mark_published(sha):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    q = '?' + urllib.parse.urlencode({'id': f'eq.{REQUEST_ID}', 'status': 'eq.approved', 'published_at': 'is.null'})
    result = rest('PATCH', 'site_update_requests', q, {'published_at': now, 'published_commit_sha': sha})
    if len(result) != 1:
        raise RuntimeError('Could not confirm publication in Supabase; inspect request state')


def main():
    row = load_request()
    if row['status'] != 'approved':
        raise ValueError('Request is not approved')
    if row['published_at']:
        print('Already published; no action required')
        return
    file = FILES.get((str(row['carrier']).lower(), str(row['province']).upper()))
    if not file:
        raise ValueError('Unsupported carrier/province')
    # Recovery: a previous run may have pushed the commit and crashed before marking Supabase.
    # Only a commit explicitly tagged with this request ID is accepted as evidence.
    prior = git('log', '--all', '--format=%H%x09%B%x00', '--', file)
    for entry in prior.split('\x00'):
        if f'AZM-Request-ID: {REQUEST_ID}' in entry:
            sha = entry.split('\t', 1)[0].strip()
            if re.fullmatch(r'[0-9a-f]{40}', sha):
                mark_published(sha)
                print('Recovered previously committed request', REQUEST_ID)
                return
    path = pathlib.Path(file)
    doc = json.loads(path.read_text(encoding='utf-8'))
    features = doc.get('features')
    if not isinstance(features, list):
        raise ValueError('Invalid GeoJSON features')
    matches = [f['properties'] for f in features if str(f.get('properties', {}).get('Site ID', '')) == str(row['site_code'])]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one site {row["site_code"]}; found {len(matches)}')
    apply(matches[0], row)
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    git('config', 'user.name', 'github-actions[bot]')
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    subprocess.check_call(['git', 'add', '--', file])
    subprocess.check_call(['git', 'commit', '-m', f'Publish approved AZM update {row["site_code"]}', '-m', f'AZM-Request-ID: {REQUEST_ID}'])
    sha = git('rev-parse', 'HEAD')
    subprocess.check_call(['git', 'push', 'origin', f'HEAD:{BRANCH}'])
    mark_published(sha)
    print('Published request', REQUEST_ID, 'at commit', sha)


if __name__ == '__main__':
    main()
