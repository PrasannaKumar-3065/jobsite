# Job Board (Express + SQLite + AdSense)

A very simple job site built to earn from Google AdSense.

**Flow:** you post a job in `/admin` → you get a link like `/job/data-analyst-acme-a1b2c3` → visitors read the details → they click **Apply now** → an ads page with a short countdown → they continue to your apply link.

## Files

| File | What it is |
|---|---|
| `server.js` | The whole site: backend, database setup, pages |
| `package.json` | Dependencies (`express`, `better-sqlite3`) and the start command |
| `.env.example` | All settings. Copy it to `.env` and edit |
| `README.md` | This guide |

Only `/job/...`, `/apply/...`, `/privacy` and `/admin` work. Any other URL shows the ads-only page (see `SHOW_HOME` below).

---

## 1. Build guide (run it on your computer)

**Requirements:** Node.js 18 or newer (check with `node -v`).

1. Put the four files above in one folder.
2. Install dependencies:
   ```
   npm install
   ```
3. Create your settings file:
   ```
   cp .env.example .env
   ```
   Open `.env` and set at least `ADMIN_PASSWORD` and `SESSION_SECRET`.
4. Start the site:
   ```
   npm start
   ```
5. Open `http://localhost:3000/admin`, log in, and post a test job. The site shows the link to the job page right after you publish.
6. Open that link, click **Apply now**, and check the ads page and the final redirect.

The database file `jobs.db` is created automatically on first run. Back it up by copying that one file.

### Git ignore (if you use GitHub)
Create a `.gitignore` file containing:
```
node_modules
.env
*.db
```

---

## 2. Settings (`.env`)

| Variable | Meaning |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin`. Change it |
| `SESSION_SECRET` | Long random text that signs the login cookie. Change it |
| `SITE_NAME` | Name in the header and page titles |
| `ADSENSE_CLIENT` | Your publisher id, like `ca-pub-1234567890123456`. Also creates `/ads.txt` automatically |
| `ADSENSE_SLOT` | Slot id of a normal responsive ad unit (used inside pages) |
| `ADSENSE_SIDE_SLOT` | Slot id of a 160x600 ad unit (desktop side ads) |
| `SHOW_HOME` | `1` = home page lists jobs. `0` = home page shows the ads-only page |
| `APPLY_WAIT_SECONDS` | Countdown length on the ads page |
| `DB_PATH` | Path to the SQLite file. On a host, put it on a persistent disk |
| `PORT` | Port to listen on (hosts usually set it for you) |

On a hosting platform you can set these as environment variables instead of using a `.env` file. Real environment variables take priority over `.env`.

---

## 3. AdSense setup checklist

1. Host the site on a domain with HTTPS (AdSense needs your own domain, not a free subdomain).
2. Post **20 to 30 real jobs** with full, original descriptions before applying. Thin or copied content gets rejected.
3. Keep `SHOW_HOME=1` while applying. Reviewers usually open your home page, and an ads-only home page looks like a site with no content.
4. Apply at adsense.google.com and add your domain. Set `ADSENSE_CLIENT` so the AdSense script loads on every page, and `/ads.txt` is served for you.
5. After approval, create two ad units in AdSense: one responsive (put its slot id in `ADSENSE_SLOT`) and one 160x600 vertical (put its slot id in `ADSENSE_SIDE_SLOT`), then restart the site.
6. Never click your own ads or ask others to. Google bans accounts for this.

---

## 4. Hosting guide

The site uses a SQLite file, so the host **must keep that file on persistent storage**. A VPS is the simplest and cheapest option. Hosts that wipe the disk on every restart will delete your jobs.

### Option A: VPS (recommended), for example Ubuntu 22.04 or 24.04

**1. Install Node.js and tools**
```
sudo apt update
sudo apt install -y nginx build-essential
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**2. Upload the four files** to `/var/www/jobsite` (use `scp`, SFTP, or git), then:
```
cd /var/www/jobsite
npm install --omit=dev
cp .env.example .env
nano .env        # set ADMIN_PASSWORD, SESSION_SECRET, SITE_NAME, PORT=3000
```

**3. Keep it running with pm2**
```
sudo npm install -g pm2
pm2 start server.js --name jobsite
pm2 save
pm2 startup      # run the command it prints, so the site restarts after a reboot
```

**4. Put nginx in front** so people reach it on port 80/443. Create `/etc/nginx/sites-available/jobsite`:
```
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
Enable it:
```
sudo ln -s /etc/nginx/sites-available/jobsite /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**5. Point your domain** to the server's IP with an `A` record in your domain's DNS settings.

**6. Add free HTTPS**
```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

**7. Check it:** open `https://yourdomain.com/admin`.

**Update later:** upload the new `server.js`, then run `pm2 restart jobsite`.

**Back up the jobs:** copy `/var/www/jobsite/jobs.db` somewhere safe now and then.

### Option B: Railway (or similar platform with volumes)

1. Put the files in a GitHub repository (with the `.gitignore` above).
2. Create a new project from that repo. The platform detects Node and runs `npm start`.
3. Add a **Volume** and mount it at `/data`.
4. In the project's variables set: `DB_PATH=/data/jobs.db`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `SITE_NAME`, and the AdSense values.
5. Add your custom domain in the platform's settings and create the DNS record it asks for. HTTPS is handled for you.

### Option C: Render

Same as Option B, but you need a paid instance with a **Disk** attached (mount path `/data`, `DB_PATH=/data/jobs.db`). The free tier wipes the disk, so do not use it for this site.

---

## 5. Troubleshooting

- **`npm install` fails on `better-sqlite3`:** install build tools (`sudo apt install build-essential python3`) and try again, and make sure Node is version 18 or newer.
- **Admin login loops back to the login page:** you are on plain `http` behind a proxy that does not send `X-Forwarded-Proto`. Use the nginx config above, or open the site over HTTPS.
- **Jobs disappear after a restart:** the database is not on persistent storage. Set `DB_PATH` to a persistent disk.
- **Ads do not show:** they only appear after AdSense approves your site and you set `ADSENSE_CLIENT` and the slot ids. New ad units can take a while to start filling.
- **The link shown after publishing has the wrong domain or `http`:** your proxy is not passing the `Host` and `X-Forwarded-Proto` headers. Use the nginx config above.