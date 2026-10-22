// GET /install: serves install.sh and records one "Install" event in Vercel
// Web Analytics. Nothing personal is stored; the only property is where the
// command came from (/install/hn), normalised to a short slug.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { track } from '@vercel/analytics/server';

const script = readFileSync(join(process.cwd(), 'install.sh'), 'utf8');

// track() posts to the deployment URL by default, which Deployment Protection
// puts behind a login; send events through the public domain instead.
process.env.VERCEL_WEB_ANALYTICS_ENDPOINT ??= 'https://skillshed.munyamakosa.com/_vercel/insights/event';

export async function GET(request) {
  const ref = new URL(request.url).searchParams.get('ref') ?? '';
  const source = /^[a-z0-9-]{1,24}$/.test(ref) ? ref : 'direct';
  // Count only real installs (curl, wget), not people opening the URL in a browser.
  const agent = request.headers.get('user-agent') ?? '';
  if (/^(curl|wget|Wget)\//.test(agent)) {
    try {
      await track('Install', { source }, { headers: request.headers });
    } catch (e) {
      console.error('install tracking failed:', e.message); // never block the install
    }
  }
  return new Response(script, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
