# PostSync · Meta & Social Media Publisher (Vercel + Supabase)

High-performance, secure web app and PWA for publishing and scheduling content across **Facebook Pages, Instagram (Feed & Reels), TikTok, YouTube Shorts, and WhatsApp Channels**. Built with modern Meta Business Suite styling and enterprise-grade security.

---

## 🌟 Key Features

1. **Meta Business Suite Media Management**:
   - Clean, compact media asset table (shows thumbnails, file names, resolutions, sizes, and placement badges).
   - Drag & drop or multi-file picker for up to 10 photos (Carousels) + 1 video (Reel).
   - Instant carousel slide reordering (`▲` and `▼`).
   - Custom Reel Cover thumbnail selector (upload custom cover or scrubber to grab exact video frame).

2. **Real-time Live Feed Previews (Meta Style)**:
   - **Facebook Feed**: Page header with verified badge, caption with hashtags, high-fidelity photo grid / carousel with navigation, and engagement bar (Like / Comment / Share).
   - **Instagram Feed**: Profile bar, carousel pagination dots, action stack (Heart / Comment / Share / Save), and formatted caption.
   - **Instagram Reels**: Immersive 9:16 layout with interactive reaction count stack and audio track metadata.
   - **WhatsApp Channel**: Card preview with single-tap share assist.

3. **Enterprise Security & Admin Access Control**:
   - **Admin Login & Role-Based Access Control (RBAC)**:
     - **Admin**: Can connect/disconnect channels, manage Graph API tokens, publish immediately, approve pending posts, invite/deactivate users, and inspect security audit logs.
     - **Editor**: Can upload media, compose captions, save drafts, and submit posts for review. Cannot view tokens, cannot connect/disconnect accounts, and cannot publish directly.
   - **Credential Protection**:
     - Meta Graph API Tokens and secrets are stored server-side only in Supabase (`account_secrets` with 0 client policies).
     - Sensitive input fields are masked (`••••••••`) with a toggle eye to prevent shoulder-surfing.
   - **Row-Level Security (RLS)**: Enforced across all tables; editors cannot schedule or delete unauthorized posts.
   - **Strict Security Headers**: CSP, X-Frame-Options (DENY), nosniff, and strict referrer policy configured in `vercel.json`.

4. **Productivity & Brand Features**:
   - **KCAL Brand Presets**: Quick insert for KCAL health, salad, and wellness hashtag sets.
   - **Character Counters**: Live counters calibrated for Instagram (2,200 chars) and Facebook.
   - **Peak Time Scheduling**: One-click best times to post (Lunch Peak 12:30 PM, Evening Prime 7:00 PM, Weekend Morning).
   - **Search & Filters**: Filter content calendar and activity log by platform, status, and keyword.
   - **Dark / Light Mode**: One-click theme switcher.

---

## 🚀 Deployment Instructions

### 1. Deploy Frontend on Vercel
1. Push this folder to your GitHub repository.
2. In [Vercel](https://vercel.com), click **Add New -> Project**, select your repository, and deploy (Framework Preset: Other / None, no build command).
3. The app is a PWA: open your Vercel URL on mobile and tap **Add to Home Screen**, or on desktop tap **Install**.

### 2. Configure Supabase Backend (Cloud Mode)
1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** and run `supabase/schema.sql`.
3. In **Authentication -> Sign In / Providers**, toggle off "Allow new users to sign up" (ensures invite-only access).
4. In **Authentication -> Users**, click **Add user** to create your primary administrator account. The first registered user automatically receives the `admin` role.
5. In **Edge Functions**, deploy both functions:
   - `supabase/functions/admin`
   - `supabase/functions/publisher`
6. Under **Database -> Extensions**, enable `pg_cron` and `pg_net`, then uncomment the cron job at the end of `schema.sql` to trigger the publisher every minute.
7. Open `config.js` and paste your Supabase Project URL and anon public key:
   ```javascript
   window.PS_CONFIG = {
     url: 'https://YOUR_PROJECT.supabase.co',
     key: 'YOUR_SUPABASE_ANON_KEY'
   };
   ```

### 3. Local / Standalone Demo Mode
- If `config.js` is left empty, PostSync runs in a fully functional local mode with realistic simulated publishing, local storage persistence, and administrative controls.
- To test the Editor role in standalone mode, sign in with any email containing "editor" (e.g. `editor@kcal.local`).
