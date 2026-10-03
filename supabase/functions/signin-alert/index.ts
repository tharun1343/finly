// Emails the account owner when a new device signs in to Finly.
// Deploy: supabase functions deploy signin-alert
// Secrets: supabase secrets set RESEND_API_KEY=... ALERT_FROM="Finly <alerts@your-domain>"
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const esc = (s: string) => String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

Deno.serve(async req => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try{
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global:{ headers:{ Authorization: auth } } });
    const { data:{ user } } = await sb.auth.getUser();
    if(!user?.email) return new Response('unauthorized', { status:401, headers: cors });
    const { deviceId } = await req.json();
    // Only alert for a device that really was just registered for this account.
    const { data: dev } = await sb.from('devices').select('name,platform,city,created_at').eq('id', deviceId).maybeSingle();
    if(!dev || Date.now() - Date.parse(dev.created_at) > 10 * 60_000) return new Response('skip', { headers: cors });
    const when = new Date(dev.created_at).toLocaleString('en-IN', { timeZone:'Asia/Kolkata', dateStyle:'medium', timeStyle:'short' });
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1d2233">
      <h2 style="margin:0 0 12px">New sign-in to Finly</h2>
      <p>Your account <b>${esc(user.email)}</b> was just signed in on a new device:</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#667">Device</td><td><b>${esc(dev.name || 'Unknown device')}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#667">Platform</td><td>${esc(dev.platform)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#667">Location</td><td>${esc(dev.city || 'Unknown')} (approximate)</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#667">Time</td><td>${esc(when)} IST</td></tr>
      </table>
      <p>If this was you, there's nothing to do. If not, open Finly → Profile → Devices and remove that device.</p></div>`;
    const r = await fetch('https://api.resend.com/emails', { method:'POST',
      headers:{ Authorization:`Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: Deno.env.get('ALERT_FROM') || 'Finly <onboarding@resend.dev>', to:[user.email], subject:'New sign-in to your Finly account', html }) });
    return new Response(r.ok ? 'sent' : 'failed', { status: r.ok ? 200 : 502, headers: cors });
  }catch(e){
    return new Response('error', { status:500, headers: cors });
  }
});
