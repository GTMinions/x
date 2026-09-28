---
name: pre-commit-critic
description: The gate every reader-visible change passes before it is pushed — two independent critics, voice and visual, each of which can block. Use in the loop before committing, and whenever shipping research prose or UI.
---

# pre-commit-critic

Before any reader-visible change is pushed, two critics review the diff **in
parallel** and each returns a verdict.

- **`critic-voice`** — the words. Banned vocabulary and constructions, unsourced
  numbers, unfalsifiable claims.
- **`critic-visual`** — the surface. Design tokens, and six craft axes. Skips
  itself if the diff has no UI.

```
git diff --staged   →   ┌─ critic-voice  ─┐
                        │                 ├─→  both approve → push
                        └─ critic-visual ─┘    either blocks → fix, re-run
```

## Why it is a separate agent

The author has already accepted every sentence once — that is what writing is.
Asking the same context to then judge whether the prose reads as machine-written
gets you the answer it already gave itself.

**Self-grading does not count.** The gate is not skippable for reader-visible
work, and the author does not overrule the critic; they fix and re-submit.

## The verdicts

| Verdict | What happens |
|---|---|
| both `approve` | push |
| any `ship-with-fix` | apply the named fixes, then push |
| any `block` | the commit does not push |

Calibration lives in each critic's own file, and it is deliberately literal —
"≥2 banned-vocabulary hits" rather than "poor voice" — so that two runs of the
same critic on the same diff reach the same verdict.

## Scope

Reader-visible surfaces: research entity prose, MOC pages, product copy,
roadmaps, changelogs, wish text, and any component that renders them.

Not: internal run logs, commit messages, code comments, scripts. Those have their
own bar and it is not this one.

## What this gate is not

It does not check whether the research is *true* — that is
[[citation-discipline]] and the researcher's drift check. It does not check
whether the code works — that is `pnpm build` plus a `/run-demo` smoke.

A page can be true, working, and still read like a machine wrote it. That is the
failure this gate exists to catch, and it is the one that self-review misses.
