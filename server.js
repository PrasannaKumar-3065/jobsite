// Minimal .env loader (no extra dependency). Real environment variables win over .env
try {
  require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch (e) { /* no .env file, that's fine */ }

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SITE_NAME = process.env.SITE_NAME || 'JobBoard';
const ADMIN_PATH = process.env.ADMIN_PATH || '/4A2B-9X7D-W3R8-55K2';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SECRET = process.env.SESSION_SECRET || 'change-this-secret';
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || ''; // e.g. ca-pub-1234567890123456
const ADSENSE_SLOT = process.env.ADSENSE_SLOT || '';     // ad unit slot id
const ADSENSE_SIDE_SLOT = process.env.ADSENSE_SIDE_SLOT || ''; // 160x600 side ad unit slot id
const SHOW_HOME = process.env.SHOW_HOME === '1'; // 1 = show job list on '/', otherwise '/' shows the ads page
const APPLY_WAIT_SECONDS = Number(process.env.APPLY_WAIT_SECONDS || 8);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'jobs.db');

const db = new Database(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  job_type TEXT,
  salary TEXT,
  description TEXT NOT NULL,
  apply_url TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const baseUrl = req => `${req.protocol}://${req.get('host')}`;
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isAdmin = req => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)adm=([a-f0-9]+)/);
  return !!m && safeEq(m[1], sign('admin'));
};
const requireAdmin = (req, res, next) => isAdmin(req) ? next() : res.redirect(ADMIN_PATH);
const fmtDate = d => new Date(d + 'Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
const paragraphs = t => esc(t).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

// ---------- templates ----------
const adUnit = () => ADSENSE_CLIENT && ADSENSE_SLOT
  ? `<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ADSENSE_CLIENT)}" data-ad-slot="${esc(ADSENSE_SLOT)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`
  : '';

const sideAd = () => ADSENSE_CLIENT && ADSENSE_SIDE_SLOT
  ? `<div class="sticky"><ins class="adsbygoogle" style="display:inline-block;width:160px;height:600px" data-ad-client="${esc(ADSENSE_CLIENT)}" data-ad-slot="${esc(ADSENSE_SIDE_SLOT)}"></ins><script>if(window.matchMedia('(min-width:1140px)').matches){(adsbygoogle=window.adsbygoogle||[]).push({});}</script></div>`
  : '';

const layout = (title, body, { noindex = false, desc = '', sides = false } = {}) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
${ADSENSE_CLIENT ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE_CLIENT)}" crossorigin="anonymous"></script>` : ''}
<style>
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#222;background:#fafafa}
a{color:#0b57d0}
.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header{background:#fff;border-bottom:1px solid #e3e3e3}
header .wrap{padding:14px 16px}
.brand{font-weight:700;font-size:20px;color:#222;text-decoration:none}
.page{display:flex;justify-content:center;gap:20px;padding:24px 16px 40px}.content{width:100%;max-width:760px;min-width:0}.rail{display:none}@media(min-width:1140px){.rail{display:block;width:160px;flex:none}.sticky{position:sticky;top:16px}}
h1{font-size:26px;line-height:1.25;margin:0 0 8px}
h2{font-size:18px;margin:24px 0 8px}
.card{background:#fff;border:1px solid #e3e3e3;border-radius:6px;padding:14px 16px;margin:0 0 10px}
.card a.t{font-weight:600;font-size:18px;text-decoration:none}
.meta{color:#666;font-size:14px}
.btn{display:inline-block;background:#0b57d0;color:#fff;border:0;border-radius:6px;padding:11px 22px;font-size:16px;text-decoration:none;cursor:pointer}
.btn[aria-disabled=true]{background:#9aa;pointer-events:none}
.ad{margin:20px 0;min-height:90px}
.placeholder{border:1px dashed #bbb;color:#999;display:flex;align-items:center;justify-content:center;font-size:13px}
label{display:block;margin:14px 0 4px;font-weight:600}
input,textarea,select{width:100%;padding:9px;border:1px solid #ccc;border-radius:6px;font:inherit}
textarea{min-height:200px}
footer{border-top:1px solid #e3e3e3;background:#fff;padding:18px 0;font-size:14px;color:#666}
.notice{background:#e8f5e9;border:1px solid #b7dfb9;padding:12px;border-radius:6px;margin-bottom:16px;word-break:break-all}
.err{background:#fdecea;border:1px solid #f5c2c0;padding:12px;border-radius:6px;margin-bottom:16px}
</style></head><body>
<header><div class="wrap">${SHOW_HOME ? `<a class="brand" href="/">${esc(SITE_NAME)}</a>` : `<span class="brand">${esc(SITE_NAME)}</span>`}</div></header>
<main class="page">${sides ? `<aside class="rail">${sideAd()}</aside>` : ''}<div class="content">${body}</div>${sides ? `<aside class="rail">${sideAd()}</aside>` : ''}</main>
<footer><div class="wrap">&copy; ${new Date().getFullYear()} ${esc(SITE_NAME)} &middot; <a href="/privacy">Privacy Policy</a></div></footer>
</body></html>`;

// ---------- public pages ----------
// Page shown for '/' and every unknown URL: only job links work
const fallbackPage = (res, status = 404) => res.status(status).send(layout(SITE_NAME,
  `<h1>Looking for a job?</h1><p>Open the job link you were given to see the full details.</p>${adUnit()}${adUnit()}${adUnit()}`,
  { noindex: true }));

app.get('/', (req, res) => {
  if (!SHOW_HOME) return fallbackPage(res, 200);
  const jobs = db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 100').all();
  const items = jobs.map((j, i) => `
    <div class="card"><a class="t" href="/job/${esc(j.slug)}">${esc(j.title)}</a>
    <div class="meta">${esc(j.company)}${j.location ? ' &middot; ' + esc(j.location) : ''}${j.job_type ? ' &middot; ' + esc(j.job_type) : ''} &middot; ${fmtDate(j.created_at)}</div></div>
    ${(i + 1) % 5 === 0 ? adUnit() : ''}`).join('');
  res.send(layout(`${SITE_NAME} - Latest jobs`,
    `<h1>Latest jobs</h1>${items || '<p>No jobs posted yet.</p>'}`,
    { desc: 'Latest job openings with details and direct apply links.' }));
});

app.get('/job/:slug', (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE slug = ?').get(req.params.slug);
  if (!j) return fallbackPage(res);
  const rows = [['Company', j.company], ['Location', j.location], ['Job type', j.job_type], ['Salary', j.salary], ['Posted', fmtDate(j.created_at)]]
    .filter(r => r[1]).map(r => `<div><strong>${r[0]}:</strong> ${esc(r[1])}</div>`).join('');
  res.send(layout(`${j.title} at ${j.company}`,
    `<h1>${esc(j.title)}</h1><div class="meta">${rows}</div>
    ${adUnit()}
    <h2>Job details</h2>${paragraphs(j.description)}
    ${adUnit()}
    <p><a class="btn" href="/apply/${esc(j.slug)}" rel="nofollow">Apply now</a></p>`,
    { desc: `${j.title} at ${j.company}${j.location ? ' in ' + j.location : ''}. Read the details and apply.`, sides: true }));
});

// Ads page shown before redirecting to the real apply link
app.get('/apply/:slug', (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE slug = ?').get(req.params.slug);
  if (!j) return fallbackPage(res);
  res.send(layout(`Apply: ${j.title}`,
    `<h1>Apply for ${esc(j.title)}</h1>
    <p>${esc(j.company)}</p>
    ${adUnit()}
    <p><a id="go" class="btn" aria-disabled="true" href="${esc(j.apply_url)}" rel="nofollow noopener">Continue to application (<span id="n">${APPLY_WAIT_SECONDS}</span>)</a></p>
    ${adUnit()}
    <p><a href="/job/${esc(j.slug)}">&larr; Back to job details</a></p>
    <script>
    var n=${APPLY_WAIT_SECONDS},go=document.getElementById('go');
    var t=setInterval(function(){n--;if(n<=0){clearInterval(t);go.removeAttribute('aria-disabled');go.textContent='Continue to application';}else{document.getElementById('n').textContent=n;}},1000);
    </script>`,
    { noindex: true, sides: true }));
});

app.get('/privacy', (req, res) => res.send(layout('Privacy Policy', `
<h1>Privacy Policy</h1>
<p>This site lists job openings and links to external application pages. We do not require you to create an account.</p>
<h2>Advertising</h2>
<p>We use Google AdSense to show ads. Google and its partners may use cookies to serve ads based on your visits to this and other websites. You can opt out of personalized advertising at <a href="https://adssettings.google.com">Google Ads Settings</a>.</p>
<h2>External links</h2>
<p>Apply links take you to third-party sites. We are not responsible for their content or privacy practices.</p>`)));

app.get('/ads.txt', (req, res) => ADSENSE_CLIENT
  ? res.type('text').send(`google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`)
  : res.status(404).send('Not found'));

app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: ${ADMIN_PATH}\nDisallow: /apply/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req);
  const urls = db.prepare('SELECT slug, created_at FROM jobs ORDER BY id DESC LIMIT 5000').all()
    .map(j => `<url><loc>${b}/job/${j.slug}</loc><lastmod>${j.created_at.slice(0, 10)}</lastmod></url>`).join('');
  res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SHOW_HOME ? `<url><loc>${b}/</loc></url>` : ''}${urls}</urlset>`);
});

// ---------- admin ----------
const adminForm = (req, extra = '') => {
  const jobs = db.prepare('SELECT id, slug, title FROM jobs ORDER BY id DESC LIMIT 30').all();
  return layout('Admin', `
  <h1>Post a job</h1>${extra}
  <form method="post" action="${ADMIN_PATH}/jobs">
    <label>Job title *</label><input name="title" required maxlength="150">
    <label>Company *</label><input name="company" required maxlength="100">
    <label>Location</label><input name="location" maxlength="100" placeholder="e.g. Bengaluru / Remote">
    <label>Job type</label><input name="job_type" maxlength="50" placeholder="e.g. Full-time">
    <label>Salary</label><input name="salary" maxlength="80">
    <label>Job details *</label><textarea name="description" required></textarea>
    <label>Apply link * (where Apply now finally sends people)</label><input name="apply_url" type="url" required placeholder="https://...">
    <p><button class="btn" type="submit">Publish job</button></p>
  </form>
  <h2>Recent jobs</h2>
  ${jobs.map(j => `<div class="card"><a href="/job/${esc(j.slug)}">${esc(j.title)}</a>
    <form method="post" action="${ADMIN_PATH}/delete/${j.id}" style="display:inline;float:right" onsubmit="return confirm('Delete this job?')"><button type="submit">Delete</button></form></div>`).join('') || '<p>None yet.</p>'}
  <p><a href="${ADMIN_PATH}/logout">Log out</a></p>`, { noindex: true });
};

app.get(ADMIN_PATH, (req, res) => {
  if (isAdmin(req)) return res.send(adminForm(req));
  res.send(layout('Admin login', `<h1>Admin login</h1>
    ${req.query.e ? '<div class="err">Wrong password.</div>' : ''}
    <form method="post" action="${ADMIN_PATH}/login"><label>Password</label><input type="password" name="password" required autofocus>
    <p><button class="btn" type="submit">Log in</button></p></form>`, { noindex: true }));
});

app.post(`${ADMIN_PATH}/login`, (req, res) => {
  if (safeEq(sign(req.body.password || ''), sign(ADMIN_PASSWORD))) {
    res.setHeader('Set-Cookie', `adm=${sign('admin')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.secure ? '; Secure' : ''}`);
    return res.redirect(ADMIN_PATH);
  }
  res.redirect(`${ADMIN_PATH}?e=1`);
});

app.get(`${ADMIN_PATH}/logout`, (req, res) => {
  res.setHeader('Set-Cookie', 'adm=; HttpOnly; Path=/; Max-Age=0');
  res.redirect(ADMIN_PATH);
});

app.post(`${ADMIN_PATH}/jobs`, requireAdmin, (req, res) => {
  const b = req.body;
  const title = (b.title || '').trim(), company = (b.company || '').trim(), description = (b.description || '').trim(), apply_url = (b.apply_url || '').trim();
  if (!title || !company || !description || !/^https?:\/\//i.test(apply_url))
    return res.status(400).send(adminForm(req, '<div class="err">Title, company, details and a valid http(s) apply link are required.</div>'));
  const slug = `${slugify(title + '-' + company) || 'job'}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare('INSERT INTO jobs (slug,title,company,location,job_type,salary,description,apply_url) VALUES (?,?,?,?,?,?,?,?)')
    .run(slug, title, company, (b.location || '').trim(), (b.job_type || '').trim(), (b.salary || '').trim(), description, apply_url);
  const link = `${baseUrl(req)}/job/${slug}`;
  res.send(adminForm(req, `<div class="notice">Job published. Share this link:<br><a href="${esc(link)}">${esc(link)}</a></div>`));
});

app.post(`${ADMIN_PATH}/delete/:id`, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(Number(req.params.id));
  res.redirect(ADMIN_PATH);
});

app.use((req, res) => fallbackPage(res));

app.listen(PORT, () => console.log(`${SITE_NAME} running on port ${PORT}`));