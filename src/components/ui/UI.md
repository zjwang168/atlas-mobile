# UI Primitives

Thin wrappers from [RN Reusables](https://rnr-docs.vercel.app/) styled with NativeWind. **Never use raw React Native primitives directly** — always use the wrappers below for consistency and dark-mode support:

| Raw RN | Use instead |
|---|---|
| `<Text>` from react-native | `<Text>` from `@/components/ui/text` |
| `<TextInput>` | `<Input>` from `@/components/ui/input` |
| `<Pressable>` / `<TouchableOpacity>` for buttons | `<Button>` from `@/components/ui/button` |
| Inline `View` with badge styling | `<Badge>` from `@/components/ui/badge` |

All components accept standard React Native props plus optional `className` for NativeWind overrides.

## Design Tokens

Use NativeWind token classes from `src/theme/tokens.css` — **never hardcode hex values** in new components:

| Token class | Light value | Dark value | Use for |
|---|---|---|---|
| `text-foreground` | neutral-950 | neutral-50 | Primary text |
| `text-text-primary` | neutral-900 | neutral-200 | Body text |
| `text-text-secondary` | neutral-700 | neutral-400 | Supporting text |
| `text-text-tertiary` | neutral-500 | neutral-500 | Captions, hints |
| `bg-background` | neutral-50 | neutral-950 | Screen / panel background |
| `bg-muted` | neutral-200 | neutral-800 | Input backgrounds, inactive chips |
| `bg-primary` | emerald-500 | emerald-500 | CTA buttons |
| `bg-secondary` | neutral-100 | neutral-800 | Secondary buttons |
| `border-border` | neutral-200 | white/10 | Dividers, card borders |
| `bg-handle` | neutral-300 | neutral-800 | Drag-handle pill |

> For icon colors use `useColorScheme()` to pick between `'#0a0a0a'` (light) and `'#fafafa'` (dark). Do not hardcode a single hex for icons.

---

## `Button`

**File:** `button.tsx`

Pressable element with variant and size options via `class-variance-authority`.

```ts
type ButtonProps = React.ComponentProps<typeof Pressable> & {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
};
```

Also exports:
- `buttonVariants(options)` — CVA variant resolver (used by `AlertDialog`)
- `buttonTextVariants(options)` — CVA text-color resolver

`TextClassContext` is injected automatically so any `<Text>` child inherits the correct color for the chosen variant.

---

## `Text`

**File:** `text.tsx`

Themed `RNText` with semantic heading roles and NativeWind variant classes.

```ts
type TextProps = React.ComponentProps<typeof RNText> & {
  variant?: 'default' | 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'blockquote'
           | 'code' | 'lead' | 'large' | 'small' | 'muted';
  asChild?: boolean;   // render as Slot (pass-through)
};
```

Also exports `TextClassContext` — a React context used by `Button` and `Badge` to propagate text color into child `Text` components without explicit props.

---

## `Input`

**File:** `input.tsx`

Styled `TextInput` with border, background, shadow, and focus-visible ring (web).

```ts
// All props forwarded to TextInput
function Input(props: React.ComponentProps<typeof TextInput>): JSX.Element
```

Disabled state (`editable={false}`) adds `opacity-50`.

---

## `Badge`

**File:** `badge.tsx`

Small rounded-full label with variant colors.

```ts
type BadgeProps = React.ComponentProps<typeof View> & {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  asChild?: boolean;
};
```

Also exports:
- `badgeVariants(options)` — container CVA resolver
- `badgeTextVariants(options)` — text CVA resolver

---

## `Avatar`

**File:** `avatar.tsx`

Circular image with a text fallback. Composed of three parts:

```tsx
<Avatar alt="User name">
  <AvatarImage source={{ uri: '...' }} />
  <AvatarFallback>
    <Text>UN</Text>
  </AvatarFallback>
</Avatar>
```

| Component | Props |
|---|---|
| `Avatar` | `alt: string` (required), `className?` |
| `AvatarImage` | Same as `Image` from `@rn-primitives/avatar` |
| `AvatarFallback` | Renders when image is absent/loading |

Default size: `size-8` (32×32). Override via `style` or `className`.

---

## `Card`

**File:** `card.tsx`

Structured content card. Composed of named sub-components:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

`CardTitle` has `role="heading"` and `aria-level={3}`. All sub-components forward `className` and standard `View`/`Text` props.

---

## `AlertDialog`

**File:** `alert-dialog.tsx`

Modal confirmation dialog built on `@rn-primitives/alert-dialog`. Exports all sub-components for composing custom dialogs:

```ts
AlertDialog           // Root (uncontrolled open state)
AlertDialogTrigger    // Opens the dialog
AlertDialogPortal     // Renders content into a portal
AlertDialogOverlay    // Backdrop (fade-in animation on native)
AlertDialogContent    // Dialog box
AlertDialogHeader     // Title + description wrapper
AlertDialogFooter     // Action buttons row
AlertDialogTitle
AlertDialogDescription
AlertDialogAction     // Confirm button (styled as default Button)
AlertDialogCancel     // Cancel button (styled as outline Button)
```

On iOS, `FullWindowOverlay` from `react-native-screens` ensures the dialog renders above navigation bars.

---

## `NativeOnlyAnimatedView`

**File:** `native-only-animated-view.tsx`

Renders `Animated.View` (from `react-native-reanimated`) on native and a plain fragment on web. Used to guard reanimated worklets that are incompatible with the web renderer.

```ts
function NativeOnlyAnimatedView(
  props: React.ComponentProps<typeof Animated.View>
): JSX.Element
```
