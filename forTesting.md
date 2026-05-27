There are two steps to get keywords injected, and then a few ways to verify what landed:

### Step 1: Generate Fresh Keywords
```bash
cd C:\PixelStortionGit\sitt-geo-engine
python orchestrator.py
```
This scrapes all 38 subreddits + RSS feeds, sends them through Gemini for verbatim extraction, and writes `latest_trends.json`. Requires `GEMINI_API_KEY` in your `.env` file.

### Step 2: Push to Cloudflare KV
The GitHub Actions workflow does this automatically (cron twice daily), but you can also do it manually:
```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/storage/kv/namespaces/YOUR_KV_NAMESPACE_ID/values/current_ecosystem_payload" \
  -H "Authorization: Bearer YOUR_CF_TOKEN" \
  -H "Content-Type: application/json" \
  -d @latest_trends.json
```

### Step 3: Deploy the Updated Worker
```bash
cd C:\PixelStortionGit\sitt-geo-engine\worker
npx wrangler deploy
```

### How to Test What Was Injected

**Locally — check the generated payload:**
```bash
cat latest_trends.json
```
This shows you exactly what keywords each domain will get.

**Live — inspect the page source after deployment:**
```bash
curl -s https://islaband.com/ | Select-String "keywords"
curl -s https://islaband.com/ | Select-String "<title>"
curl -s https://ethelryker.com/ | Select-String "keywords"
curl -s https://dominicryker.com/ | Select-String "keywords"
```

**Browser — DevTools:**
1. Open `islaband.com` → F12 → Elements
2. Search for `<meta name="keywords"` — you should see ONE tag with the verbatim phrases
3. Search for `<title>` — should show the worker-injected title, not the concatenated mess
4. Search for `application/ld+json` — should show ONLY the original hand-crafted schema

Want me to run `orchestrator.py` now to generate a fresh harvest? (You'll need a valid `GEMINI_API_KEY` in the `.env` file)