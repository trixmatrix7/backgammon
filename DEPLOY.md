# Deploying Chain Backgammon

Everything that can be prepared without credentials is done: the repository is
initialised with a first commit, `vercel.json` is written, and `npm run build:platform`
produces a verified bundle. The two steps below need you to be logged in, which is why
they are yours and not mine to run.

## 1. Push to GitHub

Log in once, then create the repository and push. Pick `--private` or `--public`
deliberately — the repository contains the game contract and the full rules engine.

```bash
gh auth login
```

```bash
gh repo create chain-backgammon --private --source=. --remote=origin --push
```

## 2. Deploy to Vercel

```bash
npx vercel login
```

```bash
npx vercel link && npx vercel --prod
```

Vercel reads `vercel.json`, so there is nothing to configure in the dashboard: it runs
`npm run build:platform`, serves `dist`, and rewrites unknown paths to `index.html` so a
deep link does not 404.

Linking the GitHub repository in the Vercel dashboard instead gives you a deploy on every
push, which is worth doing once the repository exists.

## What gets deployed, and what deliberately does not

The production build is **`build:platform`**, not `build`. It sets `VITE_DEMO_BOT=0`,
which drops the `mockHost` chunk from the bundle entirely — verified by checking that no
`mockHost-*.js` is emitted into `dist/assets/`.

That matters. The mock host *imitates* the contract: it deals real-looking dice, keeps
score and settles a pot, none of it on chain. Embedded in chain.wtf it could never
appear (it only offers itself when the app is the top window), but a deployed URL is
something people open directly — and somebody playing a convincing fake while believing
their buy-in is escrowed is the one failure worth engineering against. So it is not in
the bundle at all, rather than merely hidden.

If you want a playable demo link for showing the game to people, deploy a second Vercel
project from the same repository with the build command set to plain `npm run build`,
and keep it on a URL that is obviously a demo.

## Headers

`vercel.json` sets `nosniff` and a referrer policy, and caches hashed assets immutably.
It deliberately sets **no** `X-Frame-Options` or `frame-ancestors`: this app is an iframe
guest, and framing restrictions would break the chain.wtf integration it exists for.

## What deploying does NOT do

Deploying publishes the **client**. The game is not live until the platform side is done:

- `Backgammon.sol` must be deployed and governance must whitelist both the game address
  and the stake token, or `createLobby` reverts.
- The contract has not been audited. The differential test proves it plays the same
  backgammon as the engine — it says nothing about the safety of the escrow interaction.
- A private/public lobby setting cannot be built from the game side: `createLobby` takes
  no visibility parameter and `IPvpGameV1` has no join hook.

See [contracts/BUILD_BRIEF.md](contracts/BUILD_BRIEF.md) for the contract's state.
