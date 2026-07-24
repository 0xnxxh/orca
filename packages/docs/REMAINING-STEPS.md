# Remaining human steps (cannot complete fully in-repo)

## 1. Vercel project for open-source docs
1. Create a **new** Vercel project linked to `stablyai/orca` (not the private marketing site).
2. Set **Root Directory** to `packages/docs`.
3. Framework: Next.js; Install: `pnpm install`; Build: `pnpm build`; Output: Next default.
4. Add GitHub Actions secrets on `stablyai/orca` (docs deploy job in `.github/workflows/docs.yml`):
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID` ← must be the **docs** project ID, not marketing

## 2. Domain / path cutover for `www.onorca.dev/docs`
Today production docs still come from the private marketing site.
Options after the docs Vercel project is live:
- **A (recommended):** Point `docs.onorca.dev` at the new project, keep marketing on `www`, and reverse-proxy or rewrite `www.onorca.dev/docs/*` → docs project; **or**
- **B:** Assign `www.onorca.dev` path rewrite only if marketing and docs share one deployment (not the case after split).
- Keep `baseUrl: '/docs'` in `packages/docs` so public URLs stay `/docs/...`.

## 3. Marketing-site follow-up (private repo)
After cutover is verified:
- Remove or proxy `content/docs`, `src/app/docs`, `src/app/api/search` from `orca-marketing-website` so docs are not dual-maintained.
- Leave marketing homepage/changelog/enterprise/download/diagnostics untouched.

## 4. Local verify (already done in CI path)
```bash
cd packages/docs && pnpm install && pnpm test && pnpm build && pnpm start
# open http://localhost:3004/docs
```
