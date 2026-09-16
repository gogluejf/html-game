# html-game

A collection of AI-slop games built with Squid-OS to test its capabilities during construction.

## The Pipeline

The secret isn't "ask AI to code a game." It's building **tools first**, then using them:

1. **Sprite generation** — AI creates animation sheets (sprite-gen skill)
2. **Frame cropping** — extract individual frames from sheets (sprite-crop skill)
3. **Sprite viewer** — inspect all animations in a browser, spot bad frames, regen if needed
4. **Music composer** — procedural 8-bit chiptune with structured phrase banks (music-composer skill)
5. **Game engine** — a debug-friendly HTML engine (F1 = debug overlay, C = wireframe mode)
6. **The game itself** — last step, not first

> Learning from Abyss Qwen (2h one-shot) → Petal Panic (1 week full pipeline): the tool-first approach is **50x faster** at producing quality you'd actually want to play. One-shot AI slop stalls immediately; the pipeline compounds.

## Games

### Tool-built (full pipeline) *(average AI slop)*

| Game | Time | Notes |
|------|------|-------|
| [abyss-qwen](abyss-qwen/) | 2h | proof of concept — first run of the pipeline |
| [petal-panic](petal-panic/) | 1 week | full concept → design doc → sprites → music → engine → polish. Explicitly built with every tool in the pipeline. |

### One-shot experiments *(extreme garbage slop)*

| Game | Notes |
|------|-------|
| galaga | classic tribute |
| smb1 | platformer experiment |
| tetris | yeah |
| meowdoku | sudoku *style* but cats |
| train-simulation | because why not |
| perplexus-ghostbusters | marble maze × ghosts |

## Run

Tool-built games need a local server:

```bash
cd petal-panic && ./server.sh go
# → http://localhost:8765
```

One-shot games: just open `index.html` in a browser.

---

<p align="center">
  <img src="assets/squid-os-logo.png" alt="Squid-OS" width="150"><br>
  Powered by <a href="https://github.com/gogluejf/squid-os">Squid-OS</a>
</p>

Licensed under the [VibeCoded AI-Slop License v1.0](LICENSE). Do whatever you want. Nobody cares.
