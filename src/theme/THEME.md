# Theme

Design tokens are defined in `tokens.css` and consumed via NativeWind utility classes. Do not hardcode hex colors in components — use token classes.

## Token Reference

Full token definitions are in `tokens.css`. Quick reference:

### Semantic surface tokens
| CSS variable | NativeWind class | Purpose |
|---|---|---|
| `--background` | `bg-background` | Screen and panel backgrounds |
| `--foreground` | `text-foreground` / `bg-foreground` | Primary text and filled elements |
| `--card` | `bg-card` | Card backgrounds |
| `--primary` | `bg-primary` / `text-primary` | emerald-500 — CTA buttons |
| `--secondary` | `bg-secondary` / `text-secondary` | Secondary button fill |
| `--muted` | `bg-muted` | Input backgrounds, inactive chips |
| `--muted-foreground` | `text-muted-foreground` | Placeholder text |
| `--accent` | `bg-accent` | Hover/active state background |
| `--destructive` | `bg-destructive` | Delete / danger elements |
| `--border` | `border-border` | Dividers, card borders |
| `--input` | `border-input` / `bg-input` | Input field borders |
| `--ring` | `ring-ring` | Focus rings |

### Atlas custom tokens
| CSS variable | NativeWind class | Purpose |
|---|---|---|
| `--text-primary` | `text-text-primary` | neutral-900/200 — Body text |
| `--text-secondary` | `text-text-secondary` | neutral-700/400 — Supporting text |
| `--text-tertiary` | `text-text-tertiary` | neutral-500 — Captions, hints |
| `--handle` | `bg-handle` | neutral-300/800 — Drag handle pill |

## Adding New Tokens

1. Add the CSS variable to both `:root` (light) and `.dark` blocks in `tokens.css`.
2. Add a `--color-*` alias in the `@theme inline` block at the top of `tokens.css`.
3. Use via NativeWind class in components — do not import the CSS variable directly.

## Icon Colors

Icons cannot use CSS variables. Use `useColorScheme()`:

```ts
const colorScheme = useColorScheme();
const fg = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';
```
