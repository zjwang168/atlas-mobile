# PlanLocation

## Overview

Simple controlled text input for the trip destination. Renders a search icon alongside the `Input` primitive. Does not perform any geocoding or search — it is purely a display/capture field.

## Props

```ts
type PlanLocationProps = {
  value: string;
  onChangeText: (value: string) => void;
};
```

## Related docs

- [PLAN-DESTINATION.md](../PLAN-DESTINATION.md) — parent step that renders this input
