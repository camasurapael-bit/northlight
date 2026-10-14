/* ============================================================
   Northlight Studio — configuration
   ------------------------------------------------------------
   googleClientId: paste your Google OAuth *Web* Client ID here to
   turn on REAL Google sign-in (Google's own account picker, which
   lists the Gmail accounts on the device and has "Use another
   account").

   How to get one (free):
     1. console.cloud.google.com -> APIs & Services -> Credentials
     2. Create credentials -> OAuth client ID -> Web application
     3. Add your site to "Authorised JavaScript origins", e.g.
          http://localhost:8080        (local testing)
          https://your-site.example    (live site)
     4. Copy the Client ID (ends in .apps.googleusercontent.com) below.

   Leave it empty and the Google button opens the on-device
   chooser instead: saved accounts + type your Gmail manually.
   That fallback is NOT verified by Google.

   Note: the app must be served over http/https (for example
   `python3 -m http.server 8080`); Google sign-in does not work
   when index.html is opened as a file.
   ============================================================ */
window.NORTHLIGHT_CONFIG = {
  googleClientId: ''   // e.g. '1234567890-abc123def456.apps.googleusercontent.com'
};
