# finbuu

Vite + React + TypeScript + Tailwind.

```bash
npm install
npm run dev
npm run build
```

## Deploy

`main` branch'ine push edilince GitHub Actions `dist/` klasörünü SSH/rsync ile sunucuya yükler.

Repo secrets: `SSH_HOST`, `SSH_USER`, `SSH_KEY` (private key), `DEPLOY_PATH` (ör. `/var/www/girisimcaddesi`), `SSH_PORT` (opsiyonel, varsayılan 22).

SPA için Nginx'te: `try_files $uri /index.html;`
