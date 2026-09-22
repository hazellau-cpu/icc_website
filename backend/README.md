# ICC Backend Smoke-Test API

This is the minimum Cloud Run backend for verifying the frontend service layer before Cloud SQL integration.

## Local run

Requires Node.js 20+:

```bash
cd backend
JWT_SECRET='replace-this-secret' CORS_ORIGIN='http://localhost:8000' npm start
```

The server listens on `PORT` (default `8080`).

## Cloud Run deploy

From the repository root:

```bash
gcloud run deploy icc-backend \
  --source ./backend \
  --region asia-east2 \
  --allow-unauthenticated \
  --set-env-vars JWT_SECRET='replace-this-secret',CORS_ORIGIN='https://YOUR_GITHUB_USER.github.io'
```

`/health` is public so deployment can be checked immediately. The sample data endpoints require the frontend JWT:

```text
GET /programmes
GET /curriculum
GET /robots
GET /components
GET /centre-inventory
GET /borrowings
```

The temporary login endpoint accepts any non-empty credentials and returns a development JWT:

```text
POST /auth/login
Content-Type: application/json

{"username":"demo","password":"demo"}
```

Do not use this login implementation for production. Replace it with the real authentication service before exposing production data.

## Health check

```bash
curl https://YOUR_CLOUD_RUN_URL/health
```

Expected response:

```json
{"status":"ok","service":"icc-backend"}
```

## Cloud SQL preparation

The initial schema is in `../cloud-sql-schema.sql`. This backend intentionally does not connect to Cloud SQL yet.
