# YMCReport Design System — Metronic-inspired (MASTER, source of truth for all pages)

Arabic + RTL system (see CONTRACT.md). Font: IBM Plex Sans Arabic. Logical CSS utilities only (ms-/me-/ps-/pe-/start-/end-/text-start). Latin digits. lucide icons only. Light + dark both first-class.

## 1. Tokens (shadcn CSS vars in src/index.css + extra Tailwind colors via @theme)
| Token | Light | Dark |
|---|---|---|
| page background (`--background`) | #F5F8FA | #151521 |
| card (`--card`) | #FFFFFF | #1E1E2D |
| border (`--border`, `--input`) | #E4E6EF | #2B2B40 |
| foreground text | #181C32 | #FFFFFF |
| muted text (`--muted-foreground`) | #7E8299 | #9D9DA6 |
| muted / secondary surfaces | #F1F1F2 (gray-200), gray-100 #F9F9F9 | #2B2B40 |
| primary | #2563EB (≥4.5:1 on white) | #3B82F6 |
| primary-light (tint) | #EFF6FF | rgba(59,130,246,.16) |
| success / success-light | #0BA25F / #E8FFF3 | #4ADE80 / rgba(74,222,128,.16) |
| warning / warning-light (text uses the darker) | text #B47D00, fill #FFC700 / #FFF8DD | #FACC15 / rgba(250,204,21,.16) |
| danger (`--destructive`) / danger-light | #D9214E / #FFF5F8 | #FB7185 / rgba(251,113,133,.16) |
| info / info-light | #7239EA / #F8F5FF | #A78BFA / rgba(167,139,250,.16) |
| sidebar bg / text / active bg / heading | #1E1E2D / #9899AC / #1B1B28 (active text #FFFFFF, icon primary) / #4C4E6F | same in both modes |
| header | #FFFFFF, border-b #F1F1F2 | #1E1E2D, border-b #2B2B40 |
Radius: cards 0.625rem, buttons 0.475rem, badges 0.425rem. Card shadow: `0 0 20px 0 rgba(76,87,125,.02)` (light) / none (dark). Expose Tailwind colors: `primary-light`, `success`, `success-light`, `warning`, `warning-fill`, `warning-light`, `danger-light`, `info`, `info-light`, `sidebar-*` so classes like `bg-success-light text-success` work.

## 2. Shell (Layout.tsx)
- **Aside**: 265px fixed at the logical start, dark (#1E1E2D). Logo row (icon tile bg-primary + "YMCReport"), section labels (نظرة عامة / العمل / الإدارة / التقارير — uppercase-style 11px, #4C4E6F; a section hides when the role sees none of its items), menu items 44px tall: icon + label, hover bg-white/5, active = bg #1B1B28 + white text + primary icon + 3px primary bar at the logical start edge. Pending-tasks count badge on المهام (bg-danger, white). Bottom block: avatar initials tile (bg-primary-light text-primary) + name + role label.
- **Header**: 65px, white, sticky top. Start: hamburger (lg:hidden) + page title (bold, 1.25rem) + breadcrumb "الرئيسية / {page}" (muted xs). End: theme toggle (icon button 40px), bell with pending count badge (links to /tasks), user avatar dropdown (name, role, تسجيل الخروج).
- **Mobile (<lg)**: aside becomes a drawer sliding from the logical start with a 50% scrim, closes on route change/scrim click/Escape, focus trapped-ish (autofocus first item, restore on close). Content padding 1rem mobile / 1.5–2rem desktop. No horizontal page scroll at 375px — ever.

## 3. Components
- **Card**: white, 1px border #F1F1F2 (dark #2B2B40), radius, shadow above. Header row: title (bold 1.05rem) + optional subtitle (muted xs) at start, toolbar (buttons/filters) at end, border-b. Body p-6 (p-4 mobile).
- **Stat (KPI) card**: 44px icon tile in a light tint (each KPI its own color: primary/success/info/warning/danger), value 1.75rem bold tabular-nums, label muted sm. Grid: 2 cols on mobile, 3 md, 5 xl.
- **Badge "light"** (Metronic hallmark): tint bg + colored text, semibold, rounded-md, px-2 py-0.5, text-xs. Add variants to badge.tsx: `primary-light | success | warning | danger | info` (all light-tint). Mappings — kinds: publish=primary, create_account=success, interact=warning, general=info; priorities: عالية=danger, عادية=primary, منخفضة=info(muted); roles: super=danger, admin=primary, user=success; active/inactive: success/danger.
- **Buttons**: primary solid; `light` variant = tint bg + colored text, hover fills solid (Metronic btn-light-primary) — add to button.tsx; icon buttons ≥40px with aria-label.
- **Tables**: header cells `text-xs uppercase tracking-wide text-muted-foreground font-semibold`, rows `border-b border-dashed`, hover gray-100; identity cells use an initials avatar tile + name + secondary line; actions cluster at the end. **Mobile (<md)**: tables render as stacked cards (one card per row showing key fields + actions) — required for Accounts, Users, Tasks responses; Groups/Settings may use `overflow-x-auto` with `min-w-[640px]`.
- **Dialogs**: `sm:max-w-lg` desktop; mobile full-width, `max-h-[90dvh] overflow-y-auto`; form grids 1 col → `sm:grid-cols-2`; sticky footer buttons.
- **Filter bars**: flex-wrap, inputs full width on mobile (`w-full sm:w-auto`).
- **Empty/skeleton states**: Metronic-style centered icon tile + text + primary action.

## 4. Interaction & a11y (ui-ux-pro-max)
≥44px touch targets, visible focus rings, cursor-pointer, 150–300ms transitions, `prefers-reduced-motion` respected, contrast ≥4.5:1 (check warning text in light mode uses #B47D00, never #FFC700 for text), color never the only signal (icon/text too). Test at 375/390, 768, 1024, 1440.
