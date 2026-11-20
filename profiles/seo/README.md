# seo profile

SEO audits, applied on demand (pack 0044). Not staged.

The used part of the SEO suite is third-party and depends on its shared Python scripts (`seo/scripts/*.py`, about 700 KB), so this draft does not vendor it. The profile ships only the Read-size paths. The suite comes from a manual install: the engine can declare external skills, plugins and agents only after engine v1 (engine answer, 2026-11-02), so pack v1 documents the install steps.

## Contents (pack-owned)

| Path | What |
|---|---|
| `dotai/tools/read-size.seo.txt` | Lighthouse and crawl outputs for the base size-based Read hook |

## External items to keep (usage report, section 3.5)

Source: `AgriciDaniel/claude-seo`, MIT (`LICENSE.txt` in each installed skill).

| Kind | Items |
|---|---|
| Skills (9) | `seo`, `seo-audit`, `seo-page`, `seo-technical`, `seo-schema`, `seo-sitemap`, `seo-content`, `seo-images`, `seo-geo` |
| Agents (7) | `seo-technical`, `seo-content`, `seo-schema`, `seo-geo`, `seo-sxo`, `seo-performance`, `seo-sitemap` |
| Drop | the other 15 skills and 10 agents (unused), `seo-visual` above all |

Required patch: each kept agent declares `model: sonnet` but no `effort`, and the base Agent hook rejects a launch without both (0030). The patch adds `effort: medium` to each. `seo-sxo` reads `skills/seo-sxo/references/`, so keeping that agent also needs the `seo-sxo` skill's references. The author keeps `seo-sxo` (2026-11-02): it is the only agent that checks search intent against the live results page, so the patch also copies its references.

The patch also edits the installed `seo-audit` `SKILL.md` (step 4, "Delegate to subagents"): it removes the `seo-visual` line (launched in every audit) and the `seo-backlinks` line (its "or always include Common Crawl" clause launches it in every audit too). Without a dropped agent, `seo-audit` runs that part inline, so the lines must go, not just the agents. The other dropped agents in that list (`seo-local`, `seo-maps`, `seo-google`, `seo-cluster`, `seo-drift`, `seo-ecommerce`) are conditional on a detected signal or credential and may stay. Checked 2026-11-02 against the installed copy (lines 26 and 31).

## Cost and lifecycle

Listing only, no rules: the 9 skills cost 742 static tokens and the 7 agents 298, ~2,080 real at 2.0× ([0046](../../docs/decisions/0046-split-always-on-budget.md)). That is over the ~2,000 listing cap on its own once the base (~360) is added, and its longest descriptions are over the ~100-token per-entry limit. So `seo` is **applied for an audit and removed afterwards** (its manifest description says so, which dotai's `dotai-profiles` skill reads when it offers it, pack 0047); it never stays in a project.

While applied, Claude Code can list the skills by name only. `skillOverrides` (Claude Code settings) takes a value per skill name: `"on"`, `"name-only"` (listed without its description; `/name` still works), `"user-invocable-only"` (hidden from the model, `/name` kept) or `"off"`. It works in user, project and local settings, matched by skill name; plugin skills are not affected, but this suite installs plain skills (`~/.claude/skills/seo-*`). Sources: [skills docs](https://code.claude.com/docs/en/skills), "Override skill visibility from settings" and "Skill descriptions are cut short" (which suggests `name-only` for low-priority entries); the settings schema of the installed Claude Code 2.1.317 has the same four values. With all 9 skills `name-only` they cost ~30 static, so the profile drops to ~330 static (~660 real). The 7 agents stay: Claude Code has no equivalent for agent descriptions, and agy none for either.

The pack format can carry it: a profile's `dotai/settings.yaml` is passed through as-is to `.claude/settings.local.json` at project scope ([PACK-FORMAT, Settings](https://github.com/Lartweib/dotai/blob/main/docs/PACK-FORMAT.md#settings)). Not shipped yet, and not measured; to enable it, add `profiles/seo/dotai/settings.yaml`:

```yaml
claudecode:
  skillOverrides:
    seo: name-only
    seo-audit: name-only
    seo-page: name-only
    seo-technical: name-only
    seo-schema: name-only
    seo-sitemap: name-only
    seo-content: name-only
    seo-images: name-only
    seo-geo: name-only
```

Limits: `skillOverrides` is one settings key, so another profile that sets it would be a `profile-conflict` (engine question: merge it per skill, as `env` is per variable); a `skillOverrides` already in the project's `.claude/settings.local.json` (the `/skills` menu writes there) collides with it. `name-only` hides the trigger keywords, so the user invokes the audit by name (`/seo-audit`).
