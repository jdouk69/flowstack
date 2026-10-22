# FlowStack: finish Gmail and Drive setup later

Status on October 6, 2026: Google returned `invalid_client`. The app saved the client configuration, but no Google authorization tokens were saved. The account and permissions were selected correctly; the client ID / secret pair still needs replacing with exact copied values. Gmail collection and Drive saving are separate unfinished features.

## Selected setup

- Google Cloud project: Flow Stack, `flow-stack-510819`.
- Account to connect: `jimdoukakis@gmail.com`.
- Keep this account listed under Google Auth Platform → Audience → Test users.
- Site Settings: https://flowstack.jimdoukakis.chatgpt.site/settings.
- Exact authorized redirect URI: `https://flowstack.jimdoukakis.chatgpt.site/api/flow/google/callback`.
- OAuth client type: Web application. JavaScript origins can remain blank for this server flow.
- Keep ChatGPT sign-in protecting the private Site. The Base44 production app is separate and unchanged.

## Resume on a computer

1. Open https://console.cloud.google.com/auth/clients?project=flow-stack-510819.
2. Open the existing FlowStack Sites client. Google documents **Add Secret** on the right side of its details page. Create a new secret and copy it while visible. Keep the matching client ID.
3. If that control cannot be found, create a replacement Web application client named **FlowStack Sites 2** in this same project, with the exact redirect URI above. After Create, immediately download its JSON before closing the dialog. Do not delete existing clients during setup.
4. Use the downloaded JSON or Google's copy buttons, not a screenshot transcription. A secret hidden after closing cannot be displayed again.
5. In FlowStack Settings, choose **Replace client credentials**, enter the matching client ID and secret, and save. Do not put secrets in GitHub, application source, or this checklist.
6. Choose **Connect Google**, select `jimdoukakis@gmail.com`, review the test-app warning and the requested permissions for your own FlowStack client, and continue. Requested scopes: Gmail read-only, Drive read-only, and Drive files created/selected with this app.
7. Return to FlowStack and choose **Test Gmail and Drive**. This is a read-only access test; success does not enable automated collection yet.
8. If an error remains, retain its exact message. The app distinguishes rejected client credentials, rejected authorization code, token exchange, Gmail access, and saving errors.

Google reference: https://support.google.com/cloud/answer/15549257?hl=en.

## Work still to resume after connection succeeds

- Live token refresh / reconnection testing.
- Gmail workflow preview, attachment download, and independent storage.
- Drive folder binding, checksum comparison, uploads, browsing and merge integration.
- Full run-history / retry behavior, then optional scheduling.
- Verify this on iPhone Safari. None of these is claimed to work solely because configuration saved.
