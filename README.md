# Mvolt: build, publish and earn, all from your phone

Everything runs on your Android phone: Termux (from F-Droid, not the Play Store) + websites.
What is inside: the app (`www/`), the AI + credits server (`ai-backend/`), the build robot (`.github/`), a privacy page (`docs/`), and store pictures (`play-listing/`).

## How you earn
- **Banner ads** (Google AdMob) at the bottom of the free app.
- **Rewarded ads**: the user watches one ad and gets +5 AI credits (3 times a day).
- **Mvolt Pro** subscription: no ads, 200 AI requests a day (Google Play Billing through RevenueCat).
- **Free tier**: 15 AI credits a day per phone. Every non-AI tool is free.
- Your AI cost is about $0.0003 per request, so the AI costs far less than ads and plans bring in.

Until you add your own IDs below, the app uses Google's TEST ads (safe, earns nothing) and shows "Pro plans are coming soon".

## 0. AI + credits server (once, phone browser)
1. console.anthropic.com: create an API key and **set a monthly spend limit**.
2. cloudflare.com (free): Workers & Pages > Create > Worker named `mvolt-ai` > Deploy > Edit code > paste all of `ai-backend/worker.js` > Deploy.
3. Storage & Databases > KV > Create namespace `mvolt-limits`. Worker > Settings > Bindings > Add > KV namespace, variable name `LIMITS`.
4. Worker > Settings > Variables and Secrets: add **Secrets** `ANTHROPIC_API_KEY` (your key) and `ADMIN_KEY` (any long password you invent).
5. Copy the worker address (like `https://mvolt-ai.yourname.workers.dev`). Your AI address is that plus `/ai`.
6. Optional Variables (defaults in brackets): `DEVICE_LIMIT` (15), `PRO_LIMIT` (200), `IP_LIMIT` (40), `GLOBAL_LIMIT` (3000 AI requests a day for everyone, your safety cap), `REWARD_CREDITS` (5), `REWARD_PER_DAY` (3), `MODEL`.
7. **Your numbers**: open `https://mvolt-ai.yourname.workers.dev/stats?key=YOUR_ADMIN_KEY` in the browser: users, AI requests, rewards and top tools for the last 7 days.

## 1. Ads (AdMob)
1. admob.google.com > sign in > Add app > Android > "Not published yet" is fine. Copy the **App ID** (`ca-app-pub-...~...`).
2. Add two ad units: **Banner** and **Rewarded**. Copy both **Ad unit IDs** (`ca-app-pub-.../...`).
3. Privacy & messaging: create a consent message (GDPR) so users in Europe see the consent form.
4. On GitHub (step 3): repo > Settings > Secrets and variables > Actions > Variables: `ADMOB_APP_ID`, `ADMOB_BANNER_ID`, `ADMOB_REWARDED_ID`.
Keep testing with the test IDs first. Never tap your own live ads: that can get your AdMob account banned.

## 2. Pro plan (Play Console + RevenueCat)
1. Play Console: create the app first (step 6) and upload one build, then Monetize > Subscriptions > create `mvolt_pro_monthly` (for example Rs 99) and `mvolt_pro_yearly` (for example Rs 799). Add a base plan to each and activate them.
2. revenuecat.com (free to start): new project > add Android app (package `com.mvolt.everydaytools`) > connect to Google Play (follow its service-account steps).
3. In RevenueCat: Products > add both products. Entitlements > create one named exactly `pro` and attach both. Offerings > the Default offering > add Monthly and Annual packages.
4. API keys: copy the **Google public SDK key** (`goog_...`) and the **secret API key** (`sk_...`).
5. GitHub variable `REVENUECAT_KEY` = the `goog_...` key. Cloudflare worker Secret `REVENUECAT_SECRET` = the `sk_...` key.
6. Test with a license tester account in Play Console (Settings > License testing) before real users.

## 3. Put the project on GitHub (Termux)
1. Free account at github.com. Create a new **public** repository `mvolt-android`, empty (public so the privacy page can be hosted free).
2. Token: GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic) > `repo` permission. Copy it.
3. In Termux:
```
pkg update -y && pkg install -y git unzip openjdk-17
termux-setup-storage
cd ~ && unzip ~/storage/downloads/mvolt-android.zip -d mvolt-android
cd mvolt-android
git init -b main
git config user.name "YourName"
git config user.email "you@example.com"
git add . && git commit -m "Mvolt app"
git remote add origin https://github.com/YOURNAME/mvolt-android.git
git push -u origin main
```
(Password = the token. If `package.json` is not directly in `mvolt-android`, `cd` one folder deeper before `git init`.)
4. Repo > Settings > Secrets and variables > Actions > **Variables**: `AI_URL` = your AI address (from step 0), plus the AdMob and RevenueCat variables above.

## 4. Upload key (do this once, back it up)
```
cd ~
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks > upload.b64
cp upload.jks ~/storage/downloads/
```
Keep `upload.jks` and the password safe. Never put them in the repo.
GitHub > Settings > Secrets and variables > Actions > **Secrets**: `KEYSTORE_BASE64` (text inside `upload.b64`), `KEYSTORE_PASSWORD`, `KEY_ALIAS` (`upload`), `KEY_PASSWORD`.

## 5. Build
Repo > Actions > "Build Android bundle" > Run workflow. About 10 minutes later open the run, download `mvolt-release-aab` (a zip), unzip it to get `app-release.aab`. Every push to `main` builds again with a higher version number.

## 6. Privacy page + Play Console
1. Edit `docs/privacy.html`: replace the email line. Repo > Settings > Pages > Deploy from branch > main > /docs. Policy URL: `https://YOURNAME.github.io/mvolt-android/privacy.html`.
2. Play Console ($25 fee, identity check) > Create app > Free > upload the `.aab` to **Closed testing**.
3. Store listing: use `play-listing/icon-512.png`, `feature-1024x500.png` and the `screenshot-*.png` files.
4. Forms: content rating, target audience (18+ or general, **not** "for children": the app has ads), privacy policy URL.
5. **Ads: choose "Yes, my app contains ads".** Advertising ID: Yes (used for advertising).
6. **Data safety** (answer honestly): collects Device or other IDs (random app ID, advertising ID), Purchase history (subscription status), App interactions (tool names), and text/photos sent to AI features. Shared with Google (ads), RevenueCat (purchases) and Anthropic (AI). Data is encrypted in transit. Users cannot ask for deletion inside the app, but nothing identifies a person.
7. Personal accounts: 12 testers opted in for 14 continuous days, then apply for production. Check Google's current rule in the Console.

## Known limits
- Voice search (mic button) may not work in the Android web view.
- File conversion libraries need internet the first time.
- Rewarded credits are granted when the app reports a finished ad. This is capped per phone, per network address and per day, and your `GLOBAL_LIMIT` caps total cost. A stronger check (AdMob server-side verification) can be added later.
- I could not run the Android build or real ads/purchases here. The app screens, credits and server were tested with mock plugins. Do the test-ad and license-tester checks before launch.
