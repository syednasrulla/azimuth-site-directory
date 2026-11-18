// AZM Site Directory: administrator-triggered publication of approved requests.
// Deploy with JWT verification enabled. Do not put GitHub tokens in browser code.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN')!;
const REPO = 'syednasrulla/azimuth-site-directory';
const BRANCH = 'feature/site-updates';
const ALLOWED_ORIGINS = new Set(['http://localhost:5500', 'https://syednasrulla.github.io']);
const FILES: Record<string, string> = {
  'TELUS:BC': 'data/BC_TELUS.geojson',
  'TELUS:AB': 'data/AB_TELUS.geojson',
  'TELUS:SK': 'data/SK_TELUS.geojson',
  'Rogers:BC': 'data/BC_Rogers.geojson',
  'Rogers:AB': 'data/AB_Rogers.geojson',
};
const FIELDS = new Set(['Site Address', 'Site Info / Notes', 'Useful Contact Info']);
const ACTIONS = new Set(['add', 'replace', 'delete']);
const HEADINGS = ['Site Address', 'Site Info / Notes', 'Useful Contact Info', 'GPS Coordinates'];

type RequestRow = {
  id: string; carrier: string; province: string; site_code: string;
  field_name: string; action: string; proposed_value: string | null;
  original_value: string | null; submitted_at: string;
};
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
function json(body: unknown, status = 200, origin = '') {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json',
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  }});
}
function updateDescription(props: Record<string, unknown>, field: string) {
  const desc = String(props.description ?? '');
  const value = String(props[field] ?? '');
  const heading = `**${field}**`;
  const start = desc.indexOf(heading);
  if (start < 0) {
    // Insert new section before GPS coordinates, or append if GPS heading is absent.
    const gps = desc.indexOf('**GPS Coordinates**');
    const section = `${heading}\n\n${value}\n\n`;
    props.description = gps < 0 ? `${desc.trimEnd()}\n\n${section.trimEnd()}` : `${desc.slice(0, gps).trimEnd()}\n\n${section}${desc.slice(gps)}`;
    return;
  }
  const contentStart = start + heading.length;
  const remaining = desc.slice(contentStart);
  const next = HEADINGS.filter(h => h !== field).map(h => remaining.indexOf(`**${h}**`)).filter(n => n >= 0);
  const end = next.length ? contentStart + Math.min(...next) : desc.length;
  props.description = `${desc.slice(0, contentStart)}\n\n${value}\n\n${desc.slice(end).trimStart()}`.trimEnd();
}
function apply(props: Record<string, unknown>, req: RequestRow): boolean {
  if (!FIELDS.has(req.field_name) || !ACTIONS.has(req.action)) throw Error(`Unsupported field/action for ${req.id}`);
  const oldValue = String(props[req.field_name] ?? '');
  const incoming = String(req.proposed_value ?? '').trim();
  const original = String(req.original_value ?? '').trim();
  let newValue: string;
  if (req.action === 'replace') {
    if (!incoming) throw Error(`Empty replacement in ${req.id}`);
    // Guard against overwriting an independently edited value when the submitted old value is available.
    if (original && oldValue.trim() !== original && oldValue.trim() !== incoming) throw Error(`Conflicting existing value for ${req.site_code} / ${req.field_name}`);
    newValue = incoming;
  } else if (req.action === 'add') {
    if (req.field_name !== 'Useful Contact Info') throw Error(`Add not supported for ${req.field_name}`);
    if (!incoming) throw Error(`Empty contact in ${req.id}`);
    // Idempotent on retry: never append the same complete contact block twice.
    if (oldValue.split(/\n\s*\n/).some(s => s.trim() === incoming) || oldValue.includes(incoming)) return false;
    newValue = oldValue.trim() ? `${oldValue.trimEnd()}\n\n${incoming}` : incoming;
  } else {
    if (req.field_name !== 'Useful Contact Info') throw Error(`Delete not supported for ${req.field_name}`);
    const target = original || incoming;
    if (!target) throw Error(`Missing contact to delete in ${req.id}`);
    if (!oldValue.includes(target)) return false; // Already removed.
    newValue = oldValue.replace(target, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (oldValue === newValue) return false;
  props[req.field_name] = newValue;
  updateDescription(props, req.field_name);
  return true;
}
function decodeBase64(s: string): string {
  const raw = atob(s.replace(/\s/g, ''));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function encodeBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 16384) out += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(out);
}
async function github(path: string, method: string, body?: unknown) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, {
    method, headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(`GitHub ${method} ${path}: ${res.status} ${JSON.stringify(data).slice(0, 350)}`);
  return data;
}

Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') return json({}, 200, origin);
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed' }, 403, origin);
  if (!GITHUB_TOKEN || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) return json({ error: 'Missing server configuration' }, 500, origin);
  try {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Authentication required' }, 401, origin);
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401, origin);
    const userId = userData.user.id;
    const { data: role, error: roleError } = await admin.from('app_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (roleError || !role) return json({ error: 'Administrator access required' }, 403, origin);
    const { data: pending, error: queryError } = await admin.from('site_update_requests')
      .select('id,carrier,province,site_code,field_name,action,original_value,proposed_value,submitted_at')
      .eq('status', 'approved').is('published_at', null).order('submitted_at', { ascending: true }).limit(100);
    if (queryError) throw queryError;
    if (!pending?.length) return json({ published: 0, files: [], message: 'No unpublished approved changes' }, 200, origin);
    const byFile = new Map<string, RequestRow[]>();
    for (const row of pending as RequestRow[]) {
      const carrier = row.carrier?.toLowerCase() === 'telus' ? 'TELUS' : row.carrier?.toLowerCase() === 'rogers' ? 'Rogers' : '';
      const file = FILES[`${carrier}:${row.province?.toUpperCase()}`];
      if (!file) throw Error(`Unsupported carrier/province for ${row.site_code}`);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(row);
    }
    const results: { file: string; commit: string; requests: number }[] = [];
    // One GitHub commit per modified file. Never mark published until GitHub confirms its commit.
    for (const [path, rows] of byFile) {
      const current = await github(path, 'GET');
      // GitHub Contents API omits inline content for files larger than 1 MB.
      // Read the full blob by SHA using the Git Blobs API instead.
      const blobResponse = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${current.sha}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      });
      if (!blobResponse.ok) throw Error(`GitHub blob read failed for ${path}: ${blobResponse.status}`);
      const blob = await blobResponse.json();
      if (blob.encoding !== 'base64' || !blob.content) throw Error(`Missing base64 blob for ${path}`);
      const doc = JSON.parse(decodeBase64(blob.content));
      if (!Array.isArray(doc.features)) throw Error(`Invalid GeoJSON in ${path}`);
      const index = new Map<string, Record<string, unknown>[]>();
      for (const f of doc.features) {
        const props = f.properties as Record<string, unknown>;
        const key = String(props?.['Site ID'] ?? '');
        if (!index.has(key)) index.set(key, []);
        index.get(key)!.push(props);
      }
      let changed = false;
      for (const row of rows) {
        const matches = index.get(row.site_code) ?? [];
        if (matches.length !== 1) throw Error(`Expected exactly one ${row.site_code} in ${path}; found ${matches.length}`);
        changed = apply(matches[0], row) || changed;
      }
      let commitSha: string;
      if (changed) {
        const updated = JSON.stringify(doc);
        const saved = await github(path, 'PUT', {
          message: `Publish approved AZM site updates (${rows.length} requests)`,
          content: encodeBase64(updated), sha: current.sha, branch: BRANCH,
        });
        commitSha = saved.commit?.sha;
        if (!commitSha) throw Error(`GitHub did not return commit SHA for ${path}`);
      } else {
        // Already-applied changes: record the HEAD commit for traceability.
        const head = await fetch(`https://api.github.com/repos/${REPO}/commits/${encodeURIComponent(BRANCH)}`, {
          headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
        });
        if (!head.ok) throw Error(`Cannot verify branch HEAD for ${path}`);
        commitSha = (await head.json()).sha;
      }
      const ids = rows.map(r => r.id);
      const now = new Date().toISOString();
      const { error: markError } = await admin.from('site_update_requests')
        .update({ published_at: now, published_commit_sha: commitSha })
        .in('id', ids).eq('status', 'approved').is('published_at', null);
      if (markError) throw Error(`GitHub commit ${commitSha} succeeded, but database marking failed: ${markError.message}. Do not retry until reconciled.`);
      results.push({ file: path, commit: commitSha, requests: rows.length });
    }
    return json({ published: results.reduce((n, r) => n + r.requests, 0), files: results, branch: BRANCH }, 200, origin);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500, origin);
  }
});
