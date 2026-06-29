# SearchBar Component

## Overview

A floating URL input bar with automatic Reddit-link clipboard detection. Currently defined but not mounted in `HomeScreen` — kept for future reuse.

## File

```
src/components/search-bar/SearchBar.tsx
```

## Props

```ts
interface SearchBarProps {
  onSend: (url: string) => void;   // called when the user submits; receives trimmed text
  isLoading: boolean;              // disables input and replaces send icon with a spinner
  onHistoryPress: () => void;      // history (☰) button pressed
}
```

> **Note:** This component is currently **not mounted** anywhere in the app. It lives at `src/components/search-bar/SearchBar.tsx`. A legacy version was previously located at `src/features/home/SearchBar.tsx` (that file no longer exists). The FETCHPARSE.md doc references the legacy path — ignore those references.

## Behaviour

- **Send button** is enabled only when the trimmed input is non-empty and `isLoading` is `false`.
- **Clipboard sniffing** — on focus, reads the clipboard and prompts with an alert if it contains a Reddit URL (`reddit.com`) different from the current input value. The user can paste or cancel.
- Positioned `absolute` at `top: 56`, `left/right: 12` with `zIndex: 20`.
- Submitting via the keyboard `send` key triggers the same `onSend` path as the button.

## Helpers (internal)

```ts
isLikelyUrl(text: string): boolean  // true if text starts with http(s)://
isRedditUrl(text: string): boolean  // isLikelyUrl && contains 'reddit.com'
```
