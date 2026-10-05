/**
 * English, the default language and the source of the site's message keys.
 * Other languages must translate every key (`Dictionary` in i18n.ts).
 * `{name}` is a placeholder; objects are plural forms. The site says
 * "conspect" for a note, as the app does.
 */
export const en = {
  "site.title": "Konspecter",
  "site.description":
    "A notebook for technical conspects: plain Markdown files, offline first, on desktop, mobile and the web.",
  "site.skipToContent": "Skip to content",
  "site.home": "Konspecter home",
  "site.otherLanguage": "Русский",
  "site.otherLanguageHint": "Читать по-русски",
  "site.toLight": "Switch to the light theme",
  "site.toDark": "Switch to the dark theme",
  "site.footer": "Konspecter keeps technical conspects in Markdown.",

  "home.title": "Technical conspects in plain Markdown",
  "home.lead":
    "Konspecter is a notebook for what you learn at work: commands, queries, decisions and the reasons behind them. Every conspect is a Markdown file, it opens instantly, and it works without a network.",
  "home.specimenLabel": "A conspect as Konspecter stores it",
  "home.download": "Download for {platform}",
  "home.openWeb": "Open in the browser",
  "home.featuresTitle": "What it does",
  "home.feature.markdown.title": "The file is the conspect",
  "home.feature.markdown.text":
    "Title, dates and tags live in a short header at the top of the Markdown. Nothing is kept anywhere else, so any editor can read your notes.",
  "home.feature.editors.title": "Text or source, one key apart",
  "home.feature.editors.text":
    "Write in a clean text editor, or switch to the Markdown source when you want it. The caret stays where you left it.",
  "home.feature.tags.title": "Tags that nest",
  "home.feature.tags.text":
    "Write #databases#postgres in the text and the conspect sits under both in the tag tree. No folders to keep in order.",
  "home.feature.search.title": "Search that keeps up",
  "home.feature.search.text":
    "Full-text search with tag filters answers as you type, over every conspect on the device, online or not.",
  "home.feature.folders.title": "A folder of .md files",
  "home.feature.folders.text":
    "The desktop app can work in any folder of Markdown files, so Git, Obsidian or your editor keep working alongside it.",
  "home.feature.sync.title": "Sync the server cannot read",
  "home.feature.sync.text":
    "Connect your devices to an account and conspects are encrypted on each device before they are sent. The server stores only ciphertext.",
  "home.downloadsTitle": "Get Konspecter",
  "home.downloadsLead": "The same app on every platform, with the same files.",
  "home.platform.macos": "macOS",
  "home.platform.windows": "Windows",
  "home.platform.linux": "Linux",
  "home.platform.android": "Android",
  "home.platform.web": "Web",
  "home.platformNote.macos": "Apple silicon and Intel",
  "home.platformNote.windows": "Windows 10 and later",
  "home.platformNote.linux": "AppImage and .deb",
  "home.platformNote.android": "Android 7 and later",
  "home.platformNote.web": "Any modern browser, installable as an app",
  "home.get": "Download",
  "home.open": "Open",

  "site.signIn": "Sign in",
  "site.signOut": "Sign out",
  "site.account": "Account",
  "site.settings": "Account settings",

  "settings.title": "Settings",
  "settings.lead": "You are signed in as {email}.",
  "settings.leadNamed": "Hello, {name}. You are signed in as {email}.",
  "settings.name.title": "Your name",
  "settings.name.label": "Name",
  "settings.name.hint": "Used to greet you on this page. Leave it empty to see your email instead.",
  "settings.name.save": "Save name",
  "settings.name.saved": "Name saved.",
  "settings.devices.title": "Connected devices",
  "settings.devices.lead":
    "Apps that sync with this account. A disconnected device stops syncing and keeps its conspects.",
  "settings.devices.empty":
    "No devices yet. In the app, open Settings, then Sync, and choose Sign in with browser.",
  "settings.devices.failed": "The devices could not be loaded. Reload the page to try again.",
  "settings.devices.platformVersion": "{platform}, version {version}",
  "settings.devices.lastSynced": "Last synced {when}",
  "settings.devices.lastActive": "Last active {when}",
  "settings.devices.connected": "Connected {when}",
  "settings.devices.disconnect": "Disconnect",
  "settings.devices.disconnectNamed": "Disconnect {name}",
  "settings.devices.disconnected":
    "{name} is disconnected. It keeps its conspects and stops syncing.",
  "settings.delete.title": "Delete account",
  "settings.delete.lead":
    "This deletes the account and every conspect it keeps on the server, and disconnects all devices. Your devices keep their own conspects. It cannot be undone.",
  "settings.delete.label": "Type {email} to confirm",
  "settings.delete.submit": "Delete account",
  "settings.delete.signInAgain":
    "To delete the account, sign in again first. This makes sure it is you and not a browser left signed in.",
  "settings.delete.signInAgainButton": "Sign in again",

  "device.platform.web": "Web browser",
  "device.platform.macos": "macOS",
  "device.platform.windows": "Windows",
  "device.platform.linux": "Linux",
  "device.platform.android": "Android",
  "device.platform.ios": "iOS",
  "device.platform.other": "Other",

  "activate.title": "Connect a device",
  "activate.lead":
    "An app asks to sync with {email}. Check that this code is the one the app shows.",
  "activate.codeLabelled": "Code {code}",
  "activate.warning":
    "Approve only if you started this yourself, on your own device. An approved app can read and change every conspect you sync.",
  "activate.approve": "Approve",
  "activate.deny": "Deny",
  "activate.enterLead": "Enter the code the app shows you.",
  "activate.codeLabel": "Code from the app",
  "activate.continue": "Continue",
  "activate.approvedTitle": "Device connected",
  "activate.approved":
    "{name} can now sync with your account. Go back to the app: it carries on by itself.",
  "activate.toSettings": "See your connected devices",
  "activate.deniedTitle": "Request denied",
  "activate.denied":
    "Nothing was connected. If you did not start this, you can ignore it: the code expires soon.",

  "auth.email": "Email",
  "auth.password": "Password",
  "auth.newPassword": "New password",
  "auth.passwordHint": "At least 8 characters.",
  "auth.working": "One moment…",

  "providers.label": "Sign in with another service",
  "providers.or": "or with your email",
  "provider.google": "Continue with Google",
  "provider.linkedin": "Continue with LinkedIn",
  "provider.x": "Continue with X",
  "provider.yandex": "Continue with Yandex ID",
  "provider.vk": "Continue with VK ID",
  "providerName.google": "Google",
  "providerName.linkedin": "LinkedIn",
  "providerName.x": "X",
  "providerName.yandex": "Yandex ID",
  "providerName.vk": "VK ID",

  "login.title": "Sign in",
  "login.lead":
    "Use your password, or get a one-time code by email. A code also creates your account if you have none yet.",
  "login.submit": "Sign in",
  "login.sendCode": "Email me a code",
  "login.forgot": "Forgot your password?",
  "login.noAccount": "No account yet?",
  "login.register": "Create one",

  "register.title": "Create an account",
  "register.lead": "We will email you a code to confirm the address.",
  "register.submit": "Create account",
  "register.haveAccount": "Already have an account?",
  "register.signIn": "Sign in",
  "register.noPassword": "Rather not keep a password? {link}: it creates the account too.",
  "register.codeLink": "Sign in with an email code",

  "code.title": "Check your email",
  "code.lead": "We sent a 6-digit code to {email}. Enter it here; it works for a limited time.",
  "code.leadRegister":
    "We sent a 6-digit code to {email}. Enter it here to create your account; it works for a limited time.",
  "code.leadComplete":
    "We sent a 6-digit code to {email}. Enter it to confirm the address and finish signing in; it works for a limited time.",
  "code.label": "Code",
  "code.submit": "Continue",
  "code.resend": "Send a new code",
  "code.resent": "A new code is on its way.",
  "code.otherEmail": "Use a different email",
  "code.startOver": "Start over",

  "complete.title": "Confirm your email",
  "complete.lead":
    "{provider} did not give us a confirmed email address. Enter yours and we will send a code to check it. If you already have an account with this address, {provider} is added to it.",
  "complete.submit": "Email me a code",
  "complete.cancel": "Sign in another way",

  "forgot.title": "Forgot your password?",
  "forgot.lead": "Enter your email and we will send a link to set a new password.",
  "forgot.submit": "Send link",
  "forgot.sent":
    "We sent instructions to {email}. Open the link in the email to set a new password.",
  "forgot.back": "Back to sign in",

  "reset.title": "Set a new password",
  "reset.lead": "After this, you will be signed out of the site everywhere else.",
  "reset.submit": "Save password",
  "reset.missing": "This link is incomplete. Ask for a new one.",
  "reset.requestNew": "Ask for a new link",

  "authError.invalid_credentials": "The email or password is wrong.",
  "authError.invalid_email": "Enter a valid email address.",
  "authError.weak_password": "Use at least 8 characters.",
  "authError.password_required": "Enter your password, or ask for a code instead.",
  "authError.invalid_code":
    "This code is wrong or has expired. Check the latest email, or ask for a new code.",
  "authError.registration_closed": "This server does not take new accounts.",
  "authError.invalid_token": "This link is wrong, already used or expired. Ask for a new one.",
  "authError.rate_limited": "Too many attempts. Try again in {minutes} min.",
  "authError.mail": "The email could not be sent. Try again later.",
  "authError.not_configured": "Sign-in is not set up on this server.",
  "authError.oauth_failed":
    "Signing in with that service did not work. Try again, or use your email.",
  "authError.oauth_cancelled": "Sign-in was cancelled. Try again, or use your email.",
  "authError.provider_unavailable": "That way of signing in is not set up on this server.",
  "authError.identity_expired": "The sign-in took too long. Start it again.",
  "authError.invalid_name": "A name has at most 100 characters and no line breaks.",
  "authError.email_mismatch": "That is not this account's email. Type it exactly to confirm.",
  "authError.reauthentication_required": "Sign in again before deleting the account.",
  "authError.invalid_user_code":
    "No device is waiting for this code. Check it, or start again in the app.",
  "authError.unknown": "Something went wrong on the server. Try again in a moment.",

  "error.title": "Page not found",
  "error.notFound": "There is no page at this address.",
  "error.failed": "The page could not be shown. Try again in a moment.",
  "error.home": "Go to the home page",
};
