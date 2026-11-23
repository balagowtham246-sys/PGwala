---
name: supabase-edge-cron
description: Deploy and test secret-gated Supabase Edge Functions (e.g., cron jobs) without hitting 401 gateway JWT errors.
---

# Supabase Edge Function Cron & Secret Auth

Supabase Edge Functions enable gateway JWT verification (`verify_jwt = true`) by default. Requests without a valid `Authorization: Bearer <ANON_KEY>` header fail with `401 Unauthorized` before reaching the function handler.

## Deployment
For cron or webhook functions that validate their own custom secret header (e.g. `x-cleanup-secret`), deploy with `--no-verify-jwt`:

```powershell
npx supabase functions deploy <function-name> --no-verify-jwt
```

## Testing / Calling
- **If deployed with `--no-verify-jwt`:** Pass only the custom secret header (`x-cleanup-secret`).
- **If deployed with default JWT verification:** Pass both `Authorization: Bearer <ANON_KEY>` and the custom secret header.
