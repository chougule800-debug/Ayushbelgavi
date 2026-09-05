import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Node < 22 has no native WebSocket. Provide a transport so the Supabase
// Realtime client (created internally by createClient) does not throw.
function supabaseOptions(extra = {}) {
  return { realtime: { transport: WebSocket }, ...extra };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const staticOptions = { maxAge: '1h', etag: false };
const ENTITIES = ['members', 'announcements', 'cme', 'gallery'];

// Crash-guard: keep the server alive if an error escapes a handler.
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------
let supabaseClient = null;
function getSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, supabaseOptions({ auth: { persistSession: false } }));
  }
  return supabaseClient;
}

function isAllowedEntity(name) {
  return ENTITIES.includes(name);
}

// --- API routes ---

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/supabase-config', (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: 'Supabase is not configured', message: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.' });
  }
  return res.json({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
});

app.get('/api/:entity', async (req, res, next) => {
  const { entity } = req.params;
  if (!isAllowedEntity(entity)) return res.status(404).json({ error: 'Not found' });
  try {
    const { data, error } = await getSupabaseClient().from(entity).select('*');
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

app.post('/api/:entity', async (req, res, next) => {
  const { entity } = req.params;
  if (!isAllowedEntity(entity)) return res.status(404).json({ error: 'Not found' });
  const doc = req.body;
  if (!doc || typeof doc !== 'object' || !doc.id) {
    return res.status(400).json({ error: 'A record with an "id" field is required' });
  }
  try {
    const { data, error } = await getSupabaseClient()
      .from(entity)
      .upsert(doc, { onConflict: 'id' });
    if (error) throw error;
    return res.status(201).json({ ok: true, record: doc, response: data });
  } catch (e) {
    return next(e);
  }
});

app.put('/api/:entity/:id', async (req, res, next) => {
  const { entity, id } = req.params;
  if (!isAllowedEntity(entity)) return res.status(404).json({ error: 'Not found' });
  try {
    const { data, error } = await getSupabaseClient()
      .from(entity)
      .update(req.body)
      .eq('id', id)
      .select();
    if (error) throw error;
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

app.delete('/api/:entity/:id', async (req, res, next) => {
  const { entity, id } = req.params;
  if (!isAllowedEntity(entity)) return res.status(404).json({ error: 'Not found' });
  try {
    const { error } = await getSupabaseClient().from(entity).delete().eq('id', id);
    if (error) throw error;
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

app.post('/api/members/:id/approve', async (req, res, next) => {
  try {
    const client = getSupabaseClient();
    const { id } = req.params;

    const { data: member, error: mErr } = await client
      .from('members')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (mErr) throw mErr;
    if (!member) return res.status(404).json({ ok: false, error: 'Member not found' });

    const now = new Date().toISOString();
    const updateFields = {
      status: 'active',
      approvedAt: member.approvedAt || now,
      updatedAt: now,
    };

    let uErr = null;
    ({ error: uErr } = await client.from('members').update(updateFields).eq('id', id));
    if (uErr && typeof uErr.message === 'string' && /could not find the .* column|column .* of .* does not exist|PGRST204/i.test(uErr.message)) {
      const { error: e2 } = await client.from('members').update({ status: 'active', updatedAt: now }).eq('id', id);
      if (e2) throw e2;
      uErr = null;
    }
    if (uErr) throw uErr;

    return res.json({
      ok: true,
      member: { ...member, status: 'active', approvedAt: updateFields.approvedAt },
    });
  } catch (e) {
    return next(e);
  }
});

// --- Static files ---

app.use(express.static(__dirname, staticOptions));
app.use('/public', express.static(path.join(__dirname, 'public'), staticOptions));

// --- SPA fallback ---

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

// --- Error handling ---

app.use((err, req, res, next) => {
  console.error('Server Internal Error:', err);
  const status = err.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
  res.status(status).json({ error: status === 503 ? 'Supabase not configured' : 'Internal Server Error', message: err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});