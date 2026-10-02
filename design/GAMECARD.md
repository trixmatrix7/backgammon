# Game card (catalog)

Same formats as HOMEWRECK and The Last Dance: a 4:5 game card and a square cover, painted with the
Neo Gammon art as references. The logo is part of the painting; nothing else carries text.

| File | Size | Source job (Higgsfield, GPT Image 2.5, high, 2k) |
|---|---|---|
| `public/art/gamecard-4x5.webp` | 1122×1402 | `d0901135-3528-4f20-8141-601b6025c09f` (4:5, 1792×2240, scaled uncropped); the other variant `eeafe2b1-0ec2-4c2d-8e5e-c30c889f9986` was not used |
| `public/art/cover-1x1.webp` | 1080×1080 | `76a5b5de-2177-472e-a225-3c6a909571fa` (1:1, 2048×2048, painted square from the 4:5 card); the other variant `6b6925e4-0c5b-41f3-8f9c-664e4ec7b88a` was not used |

References for the 4:5 card: `public/assets/neo/board-neo.png`, `checkers.png`, `dice.png`,
`backdrop.png` and a screenshot of the title screen (the NEO GAMMON lettering). The square cover used
the 4:5 card and the title screenshot.

> Vertical 4:5 game cover card / key art poster for a two-player backgammon duel game called NEO GAMMON,
> painted in the exact illustration style of the reference images: bold black ink outlines, Japanese
> anime / manga comic style, halftone dot shading, speed lines and action bursts, a neon palette of hot
> pink, acid lime green, deep violet and electric cyan on near-black purple. … the upper two thirds show
> a dramatic low-angle close-up of the backgammon board … a light checker with a hot pink rim and a dark
> checker with an electric cyan rim collide in a burst of white speed lines … two purple dice with hot
> pink pips tumble through the air … the moody anime night interior … The lower third holds the game
> logo: NEO on a short first line and GAMMON large on a second line, about 85 % of the card width …
> chunky bold hand-drawn white capital letters with a thick hot pink offset shadow … Spell it exactly
> NEO GAMMON. No other text, no numbers, no user interface, no frame, no watermark.

To list the cover in the host catalog, the manifest needs `"assets": { "coverUrl": "/art/cover-1x1.webp" }`
— a field of manifest schema version 2 (`public/game.manifest.json` is still version 1).

Originals (PNG): kept outside the repository.
