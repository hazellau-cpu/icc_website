FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY db.js ./
COPY james-router.js ./
COPY sheets-read-router.js ./
COPY google-sheets.js ./
COPY password-auth.js ./
COPY set-password.js ./
COPY import-workspace-data.js ./
COPY robot-library-import-check.js ./
COPY preflight-import.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
