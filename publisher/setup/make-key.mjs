// Makes the encryption key for state/tokens.enc. Save it as the GitHub secret TOKENS_KEY.
import crypto from 'node:crypto';
const key = crypto.randomBytes(32).toString('base64');
console.log(`TOKENS_KEY=${key}

1. Add it in GitHub: repo Settings > Secrets and variables > Actions > New repository secret, name TOKENS_KEY.
2. In your terminal, before running setup:x or setup:tiktok:   export TOKENS_KEY='${key}'
Keep it somewhere safe (a password manager). Without it the saved X and TikTok logins can't be read.`);
