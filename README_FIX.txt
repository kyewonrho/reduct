REDUCT contact / diagnosis submission fix

Replace these files in the repository root:
- app.js
- api/contact.js
- vercel.json

What was fixed:
1. Primary submission still uses /api/contact.
2. If the serverless API/upstream returns a 5xx/404/405 or becomes unavailable,
   the browser automatically retries through FormSubmit AJAX.
3. CSP connect-src now explicitly permits https://formsubmit.co.
4. Same-site requests are no longer rejected solely because a privacy browser omitted Origin/Referer.
5. The 2-hour page-open timeout was removed. Only unrealistically fast/future submission timing is rejected.
6. FormSubmit upstream request now has a 10-second timeout and better logging.

Important:
- FormSubmit must have contact@reduct.co.kr activated/confirmed. If not, the first submission can require activation.
- After replacing the files, redeploy the Vercel project and hard-refresh the browser.
