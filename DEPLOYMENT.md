# Sada — Local and Production Setup

This archive contains the complete application source. It intentionally excludes `.env`, videos,
user data, API keys, generated audio/video, `node_modules`, build output and model caches.

## What you need

- **Linux** is recommended for the full feature set (Ubuntu 22.04/24.04, Debian 12 or WSL2).
- **Node.js 22 or newer** and npm.
- **PostgreSQL 14 or newer**.
- At least **4 GB RAM** for MRX. **8 GB RAM is recommended** for TIGER and production use.
- Persistent disk space for source videos, cached stems and rendered results.
- Outbound internet access for Gemini, model downloads and YouTube imports.
- A Google AI Studio key, either in `.env` or entered by each visitor in the interface.

No separate paid source-separation service is required. MRX and TIGER-DnR run locally through
ONNX Runtime. FFmpeg comes from the `ffmpeg-static` npm package. `yt-dlp` is downloaded on the
first YouTube import. The cinematic models are downloaded on first use into `.data/models`.

## 1. Install and configure

Unzip the project, open a terminal in its directory, then run:

```bash
npm install
cp .env.example .env
```

On Windows, copy `.env.example` to `.env` manually. Use WSL2 for cinematic separation and YouTube imports.

Create the database (adjust the PostgreSQL user/command for your system):

```bash
psql -U postgres -c "CREATE DATABASE app_db;"
```

Edit `.env`:

- Set `DATABASE_URL` if your PostgreSQL credentials or database name differ. If you change the
  database name/host, also update `drizzle.config.json` for the schema-push command.
- Set `GEMINI_API_KEY` if the server should provide a built-in key. You can leave it blank and
  paste a personal key into the website instead.
- Set a long random `KEY_ENCRYPTION_SECRET` in production. If omitted, the app creates a random
  secret in `DATA_DIR/secret.key`; preserve that file between deployments.

Create the tables:

```bash
npx drizzle-kit push
```

## 2. Run locally

Production mode:

```bash
npm run build
npm run start
```

Open **http://localhost:3000**. Development mode is `npm run dev`.

The backend and frontend run in the same Next.js process. Do not start two copies against the
same `DATA_DIR`: dubbing jobs run in-process and one worker should own the job queue.

## 3. Run permanently on a VPS

A small Ubuntu VPS is the simplest production target. Install Node.js 22 and PostgreSQL, copy the
project to `/var/www/sada`, configure `.env`, then complete the installation above.

Use PM2 to keep the service running:

```bash
npm install -g pm2
pm2 start npm --name sada -- run start
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs sada
pm2 restart sada
```

Put Nginx (or Caddy) in front of port 3000 and enable HTTPS. The app uses chunked 4 MB uploads,
so a proxy upload limit of 16 MB per request is sufficient; the total movie size can be much larger.
Allow long read timeouts for AI processing and do not disable byte-range responses.

Example Nginx location block:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
client_max_body_size 16m;
```

Use Certbot or your provider's load balancer for TLS. HTTPS is important when visitors paste
personal API keys.

## 4. Suitable hosting

- **Recommended:** a VPS from Hetzner, DigitalOcean, Contabo, Linode or a similar provider.
- **Also possible:** Railway, Render or Fly.io with a long-running Node service and a persistent volume.
- **Not suitable:** Vercel/Netlify-style short-lived serverless functions, because rendering,
  source separation and job state require a persistent process and disk.
- **Not production:** a temporary Google Colab session.

For MRX, start with 2–4 CPU cores and 4 GB RAM. For frequent TIGER jobs or multiple users, use
8+ GB RAM and more CPU, or a GPU worker you add yourself. `MAX_CONCURRENT_JOBS=1` is intentional
on small servers.

## 5. First-use checks

1. Open `/api/health`; it should return `{ "ok": true }`.
2. Open `/api/status`; verify FFmpeg and the active AI key.
3. Upload a short video you own.
4. Preview an Arabic voice and run a short dub.
5. For three-stem mixing, start with **MRX** and a 20–30 second clip. TIGER can take many times
   the video duration on CPU.
6. Check playback, seeking and MP4 download before processing a full movie.

## 6. Backups and updates

Back up PostgreSQL and `DATA_DIR` if you need to retain user work. The default housekeeping removes
videos after 72 hours. Personal API keys are encrypted and removed after 30 days. Never commit `.env`,
`.data` or `DATA_DIR/secret.key` to source control.

After replacing source files, run:

```bash
npm install
npx drizzle-kit push
npm run build
pm2 restart sada
```

See `README.md` for the processing architecture and all environment variables.
