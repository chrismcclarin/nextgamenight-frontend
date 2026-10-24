This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

## CI

### Encrypted test evidence

This repository is public, and anyone signed in to GitHub can download a workflow run's artifacts. The end-to-end tests run logged in, so a failure screenshot or report shows a logged-in page. Both e2e artifacts are therefore uploaded only as [age](https://age-encryption.org) ciphertext:

- `playwright-report`: the failure evidence (screenshots and pages from a red run), uploaded only when the e2e job fails.
- `month-tile-desktop-screenshots`: the desktop month-tile screenshots, uploaded on every run.

`scripts/encrypt-evidence.sh` pipes `tar` straight into `age`, encrypted to the public key in `.github/evidence-recipient.txt`, and writes `enc/<artifact>/<artifact>.tar.age`; the upload ships only that folder. `*.zip` files (Playwright traces) and `error-context.md` files are never packed. If installing `age` or encrypting fails, the step fails and nothing is uploaded; there is no plaintext fallback.

`.github/evidence-recipient.txt` holds a **public** key on purpose. It is safe to publish, and it is not a leaked secret, so do not "fix" it. The matching private key is in no repository and no GitHub secret.

### Decrypt a run's evidence

You need the private key file and `age` (on a Mac where age came from `go install`, the binary is `~/go/bin/age`).

0. `D=$(mktemp -d)` — a fresh, empty folder outside every repository. Every file below goes into it.
1. `gh run download <run-id> -n playwright-report -D "$D"` (or `-n month-tile-desktop-screenshots`, and use that name below)
2. `age -d -i <your key file> -o "$D/out.tar" "$D/playwright-report.tar.age"`
3. `tar -xf "$D/out.tar" -C "$D"`
4. When you are done, `rm -rf "$D"`. Never decrypt or extract inside a repository checkout: `out.tar` is not gitignored.

### Rotate the key

Make a new key pair with `age-keygen -o <file>` outside any repository, then replace the one recipient line in `.github/evidence-recipient.txt` with the new public key (the line `age-keygen` prints). Artifacts are kept for 7 days, so the old key is needed only for runs from the last week.
