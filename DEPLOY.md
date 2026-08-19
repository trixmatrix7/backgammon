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

## Playing the deployed build, and why it takes a flag

The deployment ships the demo opponent so the game can be tested end to end, but you
have to ask for it:

```
https://backgammon-chaingames.vercel.app/?demo=1
```

Without the flag the bare URL shows only "Loading…", which is the correct behaviour for
an iframe guest with no host to talk to. Embedded in chain.wtf the demo can never appear
at all — it only offers itself when the app is the top window.

The flag exists because the mock host imitates the contract closely: real-looking dice, a
running score, a pot that settles. That is what makes it useful for testing and exactly
what makes it risky on a public URL — somebody could play a convincing fake believing
their buy-in was escrowed. So it cannot be reached by accident, and while it is running a
fixed banner across the bottom of the screen says **"Demo — local test opponent, no
chain, no wallet, no real money"** for the whole session.

To ship a build with the bot removed from the bundle entirely rather than gated, use
`npm run build:platform` (`VITE_DEMO_BOT=0`); no `mockHost-*.js` is emitted at all.
That is the right build once real matches are running on chain.

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
