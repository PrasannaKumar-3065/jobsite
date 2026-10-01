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
// const APPLY_WAIT_SECONDS = Number(process.env.APPLY_WAIT_SECONDS || 8);
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

const jobColumns = new Set(db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name));
if (!jobColumns.has('experience_min')) db.exec('ALTER TABLE jobs ADD COLUMN experience_min INTEGER NOT NULL DEFAULT 0');
if (!jobColumns.has('experience_max')) db.exec('ALTER TABLE jobs ADD COLUMN experience_max INTEGER NOT NULL DEFAULT 0');

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
const experienceValue = value => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 50) : 0;
};
const experienceLabel = (min, max) => {
  const lower = experienceValue(min), upper = experienceValue(max);
  if (!lower && !upper) return 'Any experience';
  if (lower && upper) return `${lower}–${upper} years`;
  if (lower) return `${lower}+ years`;
  return `Up to ${upper} years`;
};

// ---------- templates ----------
const adUnit = (label = 'Advertisement') => ADSENSE_CLIENT && ADSENSE_SLOT
  ? `<div class="ad" aria-label="${esc(label)}"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ADSENSE_CLIENT)}" data-ad-slot="${esc(ADSENSE_SLOT)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`
  : `<div class="ad ad-placeholder" role="note" aria-label="${esc(label)}"><span class="ad-kicker">${esc(label)}</span><span>AdSense placement · not configured</span></div>`;

const sideAd = () => ADSENSE_CLIENT && ADSENSE_SIDE_SLOT
  ? `<div class="sticky"><div class="ad side-ad" aria-label="Advertisement"><ins class="adsbygoogle" style="display:inline-block;width:160px;height:600px" data-ad-client="${esc(ADSENSE_CLIENT)}" data-ad-slot="${esc(ADSENSE_SIDE_SLOT)}"></ins><script>if(window.matchMedia('(min-width:1140px)').matches){(adsbygoogle=window.adsbygoogle||[]).push({});}</script></div></div>`
  : `<div class="sticky"><div class="ad side-ad ad-placeholder" role="note" aria-label="Advertisement"><span class="ad-kicker">Advertisement</span><span>AdSense placement<br>not configured</span></div></div>`;

const layout = (title, body, { noindex = false, desc = '', sides = false, active = '' } = {}) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta name="theme-color" content="#18283f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap" rel="stylesheet">
${ADSENSE_CLIENT ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE_CLIENT)}" crossorigin="anonymous"></script>` : ''}
<style>
*{box-sizing:border-box}
:root{color-scheme:light;--ink:#18283f;--ink-soft:#425873;--paper:#f5f7fa;--surface:#fff;--line:#dbe3ed;--muted:#68788c;--accent:#1f6feb;--accent-dark:#1557b0;--accent-soft:#eaf2ff;--highlight:#f6b544;--shadow:0 16px 36px rgba(24,40,63,.08);--sans:'DM Sans',system-ui,sans-serif;--serif:'Newsreader',Georgia,serif}
html{scroll-behavior:smooth}
body{margin:0;font:16px/1.65 var(--sans);color:var(--ink);background:var(--paper)}
a{color:var(--ink);text-underline-offset:3px}
a:hover{color:var(--accent-dark)}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #8ab8f5;outline-offset:3px}
.wrap{width:min(1160px,100%);margin:0 auto;padding:0 26px}
header{background:var(--surface);border-bottom:1px solid var(--line)}
header .wrap{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.brand{display:flex;align-items:center;gap:11px;min-width:0;color:var(--ink);font-weight:700;font-size:18px;letter-spacing:-.035em;text-decoration:none}
.brand-mark{width:34px;height:34px;border:1px solid #b9c9dc;background:var(--accent-soft);border-radius:10px;display:grid;place-items:center;font-family:var(--serif);font-size:20px;color:var(--ink)}
.nav{display:flex;align-items:center;gap:8px}
.nav a{border-radius:8px;padding:9px 13px;color:var(--ink-soft);font-size:14px;font-weight:600;text-decoration:none;transition:background .18s ease,color .18s ease}
.nav a:hover,.nav a[aria-current=page]{background:var(--accent-soft);color:var(--ink)}
.nav .nav-cta{background:var(--ink);color:#fff}
.nav .nav-cta:hover{background:#263d5c;color:#fff}
.page{width:min(1160px,100%);margin:0 auto;display:flex;align-items:flex-start;gap:34px;padding:48px 26px 76px}
.content{width:100%;max-width:850px;min-width:0;margin:0 auto}
.rail{display:none}
@media(min-width:1200px){.rail{display:block;width:160px;flex:none;padding-top:12px}.sticky{position:sticky;top:20px}.page:has(.rail) .content{max-width:850px}}
h1,h2,h3,p{margin-top:0}
h1{font-family:var(--serif);font-size:clamp(36px,5vw,58px);font-weight:500;letter-spacing:-.035em;line-height:1.06;margin:0 0 16px}
h2{font-family:var(--serif);font-size:30px;font-weight:500;letter-spacing:-.02em;line-height:1.2;margin:0 0 14px}
h3{font-size:17px;line-height:1.4;margin:0}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-dark)}
.lead{max-width:650px;color:var(--muted);font-size:18px;line-height:1.65;margin:0}
.page-heading{margin-bottom:30px}
.hero{position:relative;overflow:hidden;background:linear-gradient(118deg,#18283f 0%,#263e5d 100%);color:#f8fbff;border-radius:20px;padding:clamp(30px,6vw,66px);margin-bottom:48px;box-shadow:var(--shadow)}
.hero:after{content:"";position:absolute;width:310px;height:310px;right:-78px;top:-110px;border:1px solid rgba(198,219,247,.32);border-radius:50%;box-shadow:0 0 0 26px rgba(198,219,247,.08),0 0 0 54px rgba(198,219,247,.05);pointer-events:none}
.hero .eyebrow{color:#a9cbff;margin-bottom:17px}
.hero h1{max-width:690px;font-size:clamp(40px,6.5vw,72px);margin-bottom:18px}
.hero .lead{color:#d9e6f5;max-width:590px}
.hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin-top:28px}
.hero-note{font-size:13px;color:#c9d8ea}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:var(--accent);color:#fff;border:1px solid var(--accent);border-radius:8px;padding:12px 20px;font:600 15px/1.3 var(--sans);text-decoration:none;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease}
.btn:hover{background:var(--accent-dark);border-color:var(--accent-dark);color:#fff;transform:translateY(-1px)}
.btn-secondary{background:transparent;color:var(--ink);border-color:#aebed0}
.btn-secondary:hover{background:var(--accent-soft);color:var(--ink);border-color:#8eabca}
.btn[aria-disabled=true]{background:#9baabd;border-color:#9baabd;pointer-events:none}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:0 0 17px}
.section-head h2{margin:0}
.text-link{font-size:14px;font-weight:700;color:var(--ink-soft);text-decoration-thickness:1px}
.job-list{display:grid;gap:12px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:0;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
.card:hover{transform:translateY(-2px);border-color:#9eb8d6;box-shadow:var(--shadow)}
.job-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.card a.t{display:inline-block;font-size:19px;line-height:1.35;font-weight:700;letter-spacing:-.02em;text-decoration:none}
.card a.t:hover{text-decoration:underline;text-decoration-color:var(--accent)}
.job-company{color:var(--ink-soft);font-size:14px;font-weight:600;margin-top:3px}
.meta{color:var(--muted);font-size:13px}
.job-meta{display:flex;flex-wrap:wrap;gap:7px 15px;margin-top:13px}
.job-meta span{display:inline-flex;align-items:center;gap:7px}
.job-meta span+span:before{content:"";width:3px;height:3px;border-radius:50%;background:#9aacc2}
.job-type{display:inline-flex;align-items:center;padding:5px 9px;border-radius:99px;background:var(--accent-soft);color:#245a9e;font-size:11px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.salary{font-size:14px;font-weight:700;color:var(--ink)}
.experience{font-size:13px;font-weight:600;color:var(--ink-soft)}
.ad{margin:30px 0;min-height:90px}
.ad-placeholder{min-height:90px;border:1px dashed #b5c5d8;border-radius:10px;background:rgba(234,242,255,.55);color:#657890;display:flex;align-items:center;justify-content:center;gap:7px;flex-direction:column;text-align:center;font-size:12px;letter-spacing:.02em}
.ad-kicker{font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7a8da5}
.side-ad{width:160px;min-height:270px}
.empty-state{padding:30px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.empty-state h3{font-family:var(--serif);font-size:24px;font-weight:500;margin-bottom:7px}
.empty-state p{color:var(--muted);margin-bottom:18px}
.trust-row{display:flex;flex-wrap:wrap;gap:12px 30px;border-top:1px solid var(--line);margin-top:40px;padding-top:20px;color:var(--muted);font-size:13px}
.trust-row span{display:flex;align-items:center;gap:8px}
.trust-mark{width:7px;height:7px;background:var(--highlight);border-radius:50%}
.home-section{margin-top:58px}
.home-section-heading{max-width:650px;margin-bottom:24px}
.home-section-heading h2{margin-bottom:8px}
.stat-grid,.feature-grid,.step-grid{display:grid;gap:14px}
.stat-grid{grid-template-columns:repeat(3,1fr);margin:0 0 10px}
.stat{padding:21px 22px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.stat strong{display:block;font-family:var(--serif);font-size:34px;font-weight:500;line-height:1;color:var(--ink)}
.stat span{display:block;color:var(--muted);font-size:13px;margin-top:8px}
.feature-grid{grid-template-columns:repeat(3,1fr)}
.feature{padding:24px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.feature-number{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--accent-soft);color:var(--accent-dark);font-size:12px;font-weight:700;margin-bottom:19px}
.feature h3{margin-bottom:8px}
.feature p,.step p{color:var(--muted);font-size:14px;margin:0}
.step-grid{grid-template-columns:repeat(3,1fr);counter-reset:steps}
.step{position:relative;padding:4px 0 0 44px}
.step:before{counter-increment:steps;content:counter(steps);position:absolute;left:0;top:0;width:29px;height:29px;display:grid;place-items:center;border-radius:50%;background:var(--ink);color:#fff;font-size:12px;font-weight:700}
.step h3{margin-bottom:7px}
.home-cta{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 30px;border-radius:14px;background:var(--accent-soft);border:1px solid #c9dbf0}
.home-cta h2{font-size:28px;margin-bottom:5px}
.home-cta p{color:var(--ink-soft);font-size:14px;margin:0}
.filters{padding:20px 22px;margin:0 0 26px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:0 8px 24px rgba(24,40,63,.04)}
.filter-grid{display:grid;grid-template-columns:1.45fr repeat(5,1fr);gap:12px}
.filter-grid label{margin:0}
.filter-grid input{margin-top:6px}
.filter-actions{display:flex;align-items:center;gap:13px;margin-top:16px}
.filter-actions .btn{padding:10px 17px}
.filter-reset{font-size:13px;color:var(--muted);font-weight:600}
.detail-top{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:30px}
.detail-top .eyebrow{margin-bottom:12px}
.detail-top h1{font-size:clamp(36px,5vw,54px)}
.detail-company{font-size:18px;color:var(--ink-soft);font-weight:600}
.job-facts{display:flex;flex-wrap:wrap;gap:10px;margin:25px 0 0}
.job-facts div{min-width:130px;padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:rgba(255,254,250,.64)}
.job-facts dt{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
.job-facts dd{margin:2px 0 0;font-size:14px;font-weight:600}
.description{font-size:16px;color:#40536b}
.description p{margin:0 0 16px}
.apply-panel{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px;padding:22px 24px;background:var(--accent-soft);border:1px solid #c9dbf0;border-radius:12px;margin:28px 0}
.apply-panel p{margin:0;color:var(--ink-soft);font-size:14px}
.apply-panel h2{font-size:23px;margin:0 0 4px}
.back-link{display:inline-block;margin:0 0 24px;font-size:14px;font-weight:600}
label{display:block;margin:16px 0 5px;font-weight:700;font-size:14px}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid #b9c8d9;border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}
textarea{min-height:200px}
button{font-family:inherit}
footer{border-top:1px solid var(--line);background:#edf1f6;padding:24px 0;font-size:13px;color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
footer a{color:var(--ink-soft)}
.notice{background:var(--accent-soft);border:1px solid #b9d2f0;padding:14px 16px;border-radius:8px;margin-bottom:16px;word-break:break-all}
.err{background:#f7e8df;border:1px solid #e5bda7;padding:14px 16px;border-radius:8px;margin-bottom:16px}
.not-found{padding:22px 0 10px}
.not-found .lead{margin-bottom:22px}
@media(max-width:1000px){.filter-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:767px){.wrap{padding:0 18px}header .wrap{min-height:70px;gap:10px}.brand{font-size:16px}.brand-mark{width:31px;height:31px}.nav{gap:2px}.nav a{padding:8px 9px;font-size:12px}.page{padding:30px 18px 54px}.hero{border-radius:15px;margin-bottom:38px}.hero:after{right:-170px}.hero .lead{font-size:16px}.job-card-top{display:block}.job-type{margin-top:12px}.card{padding:18px}.section-head{align-items:flex-start}.section-head h2{font-size:26px}.job-facts{gap:8px}.job-facts div{flex:1 1 42%}.apply-panel{align-items:flex-start;padding:19px}.apply-panel .btn{width:100%}.filter-grid{grid-template-columns:1fr}.filter-actions{align-items:flex-start;flex-direction:column}.filter-actions .btn{width:100%}.stat-grid,.feature-grid,.step-grid{grid-template-columns:1fr}.home-cta{align-items:flex-start;flex-direction:column;padding:22px}.home-cta .btn{width:100%}}
@media(max-width:390px){header .wrap{align-items:flex-start;padding-top:13px;padding-bottom:13px;flex-direction:column}.nav{width:100%}.nav a{flex:1;text-align:center}.hero-actions .btn{width:100%}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition:none!important}}
</style></head><body>
<header><div class="wrap">
  <a class="brand" href="/" aria-label="${esc(SITE_NAME)} home"><span class="brand-mark" aria-hidden="true">${esc(SITE_NAME.slice(0, 1).toUpperCase())}</span><span>${esc(SITE_NAME)}</span></a>
  <nav class="nav" aria-label="Primary navigation"><a href="/"${active === 'home' ? ' aria-current="page"' : ''}>Home</a><a class="nav-cta" href="/jobs"${active === 'jobs' ? ' aria-current="page"' : ''}>Browse jobs</a></nav>
</div></header>
<main class="page">${sides ? `<aside class="rail" aria-label="Advertisement">${sideAd()}</aside>` : ''}<div class="content">${body}</div></main>
<footer><div class="wrap"><span>&copy; ${new Date().getFullYear()} ${esc(SITE_NAME)}</span><a href="/privacy">Privacy Policy</a></div></footer>
</body></html>`;

// ---------- public pages ----------
const jobCard = (j, i = -1) => `
  <article class="card">
    <div class="job-card-top">
      <div><a class="t" href="/job/${esc(j.slug)}">${esc(j.title)}</a><div class="job-company">${esc(j.company)}</div></div>
      ${j.job_type ? `<span class="job-type">${esc(j.job_type)}</span>` : ''}
    </div>
    <div class="job-meta meta">
      ${j.location ? `<span>${esc(j.location)}</span>` : ''}
      <span>Posted ${fmtDate(j.created_at)}</span>
      ${j.salary ? `<span class="salary">${esc(j.salary)}</span>` : ''}
      <span class="experience">${experienceLabel(j.experience_min, j.experience_max)}</span>
    </div>
  </article>${i >= 0 && (i + 1) % 5 === 0 ? adUnit() : ''}`;

const fallbackPage = (res, status = 404) => res.status(status).send(layout(`Page not found | ${SITE_NAME}`,
  `<section class="not-found"><p class="eyebrow">That page isn't here</p><h1>Find your next opportunity.</h1><p class="lead">The link may have changed. Browse the current openings or head back to the home page.</p><p style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a class="btn" href="/jobs">Browse jobs</a><a class="btn btn-secondary" href="/">Go home</a></p></section>${adUnit()}`,
  { noindex: true }));

app.get('/', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS total FROM jobs').get().total;
  res.send(layout(`${SITE_NAME} | Find your next opportunity`,
    `<section class="hero">
      <p class="eyebrow">A better way to move forward</p>
      <h1>Find work that fits the way you want to work.</h1>
      <p class="lead">Discover useful opportunities, understand the role before you apply, and connect with employers through a clear, direct process.</p>
      <div class="hero-actions"><a class="btn" href="/jobs">Explore open jobs</a><span class="hero-note">Trusted details. Direct applications.</span></div>
    </section>
    <section class="home-section" aria-labelledby="platform-heading">
      <div class="home-section-heading"><p class="eyebrow">Built for better searches</p><h2 id="platform-heading">Everything you need to make a confident next move.</h2><p class="lead">A focused job board for people who value clarity, useful context, and a straightforward path from discovery to application.</p></div>
      <div class="stat-grid">
        <div class="stat"><strong>${count}</strong><span>${count === 1 ? 'open opportunity' : 'open opportunities'} currently listed</span></div>
        <div class="stat"><strong>01</strong><span>clear place to explore current roles</span></div>
        <div class="stat"><strong>Direct</strong><span>applications through the employer link</span></div>
      </div>
    </section>
    <section class="home-section" aria-labelledby="why-heading">
      <div class="home-section-heading"><p class="eyebrow">Why use ${esc(SITE_NAME)}</p><h2 id="why-heading">Less noise. More useful information.</h2></div>
      <div class="feature-grid">
        <article class="feature"><span class="feature-number">01</span><h3>See the details first</h3><p>Review the company, location, role type, pay, and experience range before deciding where to apply.</p></article>
        <article class="feature"><span class="feature-number">02</span><h3>Search with intention</h3><p>Use practical filters to narrow the list by role, location, work type, pay, and experience.</p></article>
        <article class="feature"><span class="feature-number">03</span><h3>Apply without detours</h3><p>When a role feels right, continue directly to the employer's application page.</p></article>
      </div>
    </section>
    <section class="home-section" aria-labelledby="steps-heading">
      <div class="home-section-heading"><p class="eyebrow">A simple process</p><h2 id="steps-heading">From search to next step in three clear moves.</h2></div>
      <div class="step-grid">
        <div class="step"><h3>Browse</h3><p>Explore current openings and use filters to focus your search.</p></div>
        <div class="step"><h3>Understand</h3><p>Open a listing to read the full role details and requirements.</p></div>
        <div class="step"><h3>Apply</h3><p>Continue to the employer's application flow when you're ready.</p></div>
      </div>
    </section>
    <section class="home-section home-cta" aria-labelledby="cta-heading">
      <div><h2 id="cta-heading">Ready to see what's next?</h2><p>Start with the latest opportunities and find the role that fits.</p></div>
      <a class="btn" href="/jobs">Browse jobs</a>
    </section>
    ${adUnit('Advertisement')}`,
    { desc: `Explore opportunities on ${SITE_NAME}. Review clear role details and apply directly.`, active: 'home' }));
});

app.get('/jobs', (req, res) => {
  const filters = {
    q: String(req.query.q || '').trim().slice(0, 100),
    location: String(req.query.location || '').trim().slice(0, 100),
    job_type: String(req.query.job_type || '').trim().slice(0, 50),
    salary: String(req.query.salary || '').trim().slice(0, 80),
    min_experience: experienceValue(req.query.min_experience),
    max_experience: experienceValue(req.query.max_experience)
  };
  const conditions = [];
  const params = [];
  if (filters.q) {
    conditions.push('(title LIKE ? OR company LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.location) {
    conditions.push('location LIKE ?');
    params.push(`%${filters.location}%`);
  }
  if (filters.job_type) {
    conditions.push('job_type LIKE ?');
    params.push(`%${filters.job_type}%`);
  }
  if (filters.salary) {
    conditions.push('salary LIKE ?');
    params.push(`%${filters.salary}%`);
  }
  if (filters.min_experience) {
    conditions.push('(experience_min = 0 OR experience_min <= ?)');
    params.push(filters.min_experience);
    conditions.push('(experience_max = 0 OR experience_max >= ?)');
    params.push(filters.min_experience);
  }
  if (filters.max_experience) {
    conditions.push('(experience_min <= ?)');
    params.push(filters.max_experience);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const jobs = db.prepare(`SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT 100`).all(...params);
  const hasFilters = Object.values(filters).some(Boolean);
  const listing = jobs.map((j, i) => jobCard(j, i)).join('');
  res.send(layout(`Browse jobs | ${SITE_NAME}`,
    `<section class="page-heading"><p class="eyebrow">Open opportunities</p><h1>Browse jobs</h1><p class="lead">Search current roles and find the details you need to make your next move.</p></section>
    <form class="filters" method="get" action="/jobs" aria-label="Filter job listings">
      <div class="filter-grid">
        <label>Search title or company<input name="q" value="${esc(filters.q)}" placeholder="e.g. designer or Acme"></label>
        <label>Location<input name="location" value="${esc(filters.location)}" placeholder="e.g. Remote"></label>
        <label>Job type<input name="job_type" value="${esc(filters.job_type)}" placeholder="e.g. Full-time"></label>
        <label>Salary / pay<input name="salary" value="${esc(filters.salary)}" placeholder="e.g. ₹10 LPA"></label>
        <label>Min experience<input type="number" name="min_experience" min="0" max="50" value="${filters.min_experience || ''}" placeholder="Years"></label>
        <label>Max experience<input type="number" name="max_experience" min="0" max="50" value="${filters.max_experience || ''}" placeholder="Years"></label>
      </div>
      <div class="filter-actions"><button class="btn" type="submit">Apply filters</button>${hasFilters ? '<a class="filter-reset" href="/jobs">Clear filters</a>' : ''}</div>
    </form>
    <section aria-label="Job listings"><div class="section-head"><h2>${jobs.length ? 'Latest openings' : 'Open roles'}</h2><span class="meta">${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} listed${hasFilters ? ' · filtered' : ''}</span></div>
    <div class="job-list">${listing || `<div class="empty-state"><h3>No openings listed yet.</h3><p>There are no jobs to browse right now. Please check back soon.</p><a class="btn btn-secondary" href="/">Return home</a></div>`}</div></section>`,
    { desc: `Browse current job openings from ${SITE_NAME}.`, active: 'jobs' }));
});

app.get('/job/:slug', (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE slug = ?').get(req.params.slug);
  if (!j) return fallbackPage(res);
  const rows = [['Location', j.location], ['Job type', j.job_type], ['Salary', j.salary], ['Experience', experienceLabel(j.experience_min, j.experience_max)], ['Posted', fmtDate(j.created_at)]]
    .filter(r => r[1]).map(r => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('');
  res.send(layout(`${j.title} at ${j.company}`,
    `<a class="back-link" href="/jobs">&larr; All jobs</a>
    <section class="detail-top"><p class="eyebrow">Job opening</p><h1>${esc(j.title)}</h1><div class="detail-company">${esc(j.company)}</div><dl class="job-facts">${rows}</dl></section>
    ${adUnit()}
    <section class="description"><h2>Job details</h2>${paragraphs(j.description)}</section>
    ${adUnit()}
    <section class="apply-panel" aria-label="Apply for this position"><div><h2>Interested in this role?</h2><p>Review the details, then continue directly to the employer's application page.</p></div><a class="btn" href="${esc(j.apply_url)}" target="_blank" rel="nofollow noopener noreferrer">Apply now</a></section>`,
    { desc: `${j.title} at ${j.company}${j.location ? ' in ' + j.location : ''}. Read the details and apply.`, sides: true }));
});

// // Ads page shown before redirecting to the real apply link
// app.get('/apply/:slug', (req, res) => {
//   const j = db.prepare('SELECT * FROM jobs WHERE slug = ?').get(req.params.slug);
//   if (!j) return fallbackPage(res);
//   res.send(layout(`Apply: ${j.title}`,
//     `<h1>Apply for ${esc(j.title)}</h1>
//     <p>${esc(j.company)}</p>
//     ${adUnit()}
//     <p><a id="go" class="btn" aria-disabled="true" href="${esc(j.apply_url)}" rel="nofollow noopener">Continue to application (<span id="n">${APPLY_WAIT_SECONDS}</span>)</a></p>
//     ${adUnit()}
//     <p><a href="/job/${esc(j.slug)}">&larr; Back to job details</a></p>
//     <script>
//     var n=${APPLY_WAIT_SECONDS},go=document.getElementById('go');
//     var t=setInterval(function(){n--;if(n<=0){clearInterval(t);go.removeAttribute('aria-disabled');go.textContent='Continue to application';}else{document.getElementById('n').textContent=n;}},1000);
//     </script>`,
//     { noindex: true, sides: true }));
// });

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

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: ${ADMIN_PATH}\nDisallow: /apply/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const b = baseUrl(req);
  const urls = db.prepare('SELECT slug, created_at FROM jobs ORDER BY id DESC LIMIT 5000').all()
    .map(j => `<url><loc>${b}/job/${j.slug}</loc><lastmod>${j.created_at.slice(0, 10)}</lastmod></url>`).join('');
  res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${b}/</loc></url><url><loc>${b}/jobs</loc></url>${urls}</urlset>`);
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
    <label>Minimum experience (years)</label><input name="experience_min" type="number" min="0" max="50" placeholder="Optional — use 0 for entry-level">
    <label>Maximum experience (years)</label><input name="experience_max" type="number" min="0" max="50" placeholder="Optional — use 0 for no maximum">
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
  const experience_min = experienceValue(b.experience_min), experience_max = experienceValue(b.experience_max);
  if (!title || !company || !description || !/^https?:\/\//i.test(apply_url))
    return res.status(400).send(adminForm(req, '<div class="err">Title, company, details and a valid http(s) apply link are required.</div>'));
  if (experience_max && experience_min > experience_max)
    return res.status(400).send(adminForm(req, '<div class="err">Maximum experience must be greater than or equal to minimum experience.</div>'));
  const slug = `${slugify(title + '-' + company) || 'job'}-${crypto.randomBytes(3).toString('hex')}`;
  db.prepare('INSERT INTO jobs (slug,title,company,location,job_type,salary,experience_min,experience_max,description,apply_url) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(slug, title, company, (b.location || '').trim(), (b.job_type || '').trim(), (b.salary || '').trim(), experience_min, experience_max, description, apply_url);
  const link = `${baseUrl(req)}/job/${slug}`;
  res.send(adminForm(req, `<div class="notice">Job published. Share this link:<br><a href="${esc(link)}">${esc(link)}</a></div>`));
});

app.post(`${ADMIN_PATH}/delete/:id`, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(Number(req.params.id));
  res.redirect(ADMIN_PATH);
});

app.use((req, res) => fallbackPage(res));

app.listen(PORT, () => console.log(`${SITE_NAME} running on port ${PORT}`));