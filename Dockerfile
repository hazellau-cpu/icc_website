FROM node:20-slim

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

WORKDIR /app
COPY backend/server.js backend/db.js backend/james-router.js backend/sheets-read-router.js backend/google-sheets.js backend/google-access-token.js backend/google-calendar.js backend/iap-auth.js backend/password-auth.js backend/starter-demographics.js backend/sheets-workspace-store.js backend/sheets-workspace.js ./backend/
COPY app.js services.js local-calendar-mapping.js local-pathways.js local-live-sheets.js styles.css index.html icc-config.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/server.js"]
