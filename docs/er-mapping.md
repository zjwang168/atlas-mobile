# OurAtlas MVP Data Model

## User

A user can:

- create places
- create collections
- create plans
- import content
- participate in chats
- interact with places

Relationships:

- User 1:N Places
- User 1:N Collections
- User 1:N Plans
- User 1:N Imports
- User 1:N ChatSessions
- User 1:N UserPlaceInteractions

---

## Place

A place represents a saved location, restaurant, activity, or destination.

A place can:

- belong to multiple collections
- belong to multiple plans
- originate from imported content
- contain AI-generated summaries
- receive user interactions

Relationships:

- Place N:N Collections
- Place N:N Plans
- Place 1:N PlaceSources
- Place 1:N UserPlaceInteractions

Implemented through:

- atlas_places
- plan_places

---

## Collection

Collections are lightweight saved folders.

Examples:

- NYC Cafes
- Tokyo Ramen
- Summer Food List

Relationships:

- Collection N:N Places

Implemented through:

- atlas_places

---

## Plan

Plans are structured planning spaces.

Examples:

- Japan Trip 2026
- NYC Weekend
- Korea Food Tour

Plans can:

- contain places
- contain itinerary days
- contain itinerary items
- contain chat sessions
- have multiple members
- receive imports

Relationships:

- Plan N:N Places
- Plan N:N Users
- Plan 1:N ItineraryDays
- Plan 1:N Imports
- Plan 1:N ChatSessions

Implemented through:

- plan_itinerary_place_flexible
- plan_members

---

## Import

Imports represent content brought into the app.

Supported inputs:

- links
- screenshots
- pasted text
- social media posts

Imports can generate:

- extracted places
- AI summaries
- metadata

Relationships:

- User 1:N Imports
- Plan 1:N Imports
- Import 1:N ExtractedPlaces

---

## Extracted Place

Represents AI-generated place candidates before becoming official places.

Relationships:

- Import 1:N ExtractedPlaces

---

## Chat System

Supports AI-native workflows.

Examples:

- generate itinerary
- ask about saved places
- summarize imported content
- plan routes

Relationships:

- ChatSession 1:N ChatMessages
- Plan 1:N ChatSessions

---

## Itinerary System

Plans contain itinerary structures.

A place saved to a plan (`plan_itinerary_place_flexible`) is "flexible" until it also has a `plan_itinerary_places` row; once scheduled onto a day, its `visit_slot` (morning / noon / afternoon / night) buckets it within that day. `plan_itinerary_places` has no precise `start_time`/`end_time` — only the coarse `visit_slot` bucket. The same place may appear more than once across `plan_itinerary_place_flexible` and/or `plan_itinerary_places` within one plan.

Relationships:

- Plan 1:N ItineraryDays
- ItineraryDay 1:N ItineraryItems
- ItineraryItem N:1 Place

---

## User Interaction Tracking

Tracks:

- saves
- views
- clicks
- recommendations
- engagement

Relationships:

- User 1:N UserPlaceInteractions
- Place 1:N UserPlaceInteractions