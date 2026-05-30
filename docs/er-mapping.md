# OurAtlas MVP Data Model

## User

A user can:

- create places
- create collections
- create projects
- import content
- participate in chats
- interact with places

Relationships:

- User 1:N Places
- User 1:N Collections
- User 1:N Projects
- User 1:N Imports
- User 1:N ChatSessions
- User 1:N UserPlaceInteractions

---

## Place

A place represents a saved location, restaurant, activity, or destination.

A place can:

- belong to multiple collections
- belong to multiple projects
- originate from imported content
- contain AI-generated summaries
- receive user interactions

Relationships:

- Place N:N Collections
- Place N:N Projects
- Place 1:N PlaceSources
- Place 1:N UserPlaceInteractions

Implemented through:

- collection_places
- project_places

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

- collection_places

---

## Project

Projects are structured planning spaces.

Examples:

- Japan Trip 2026
- NYC Weekend
- Korea Food Tour

Projects can:

- contain places
- contain itinerary days
- contain itinerary items
- contain chat sessions
- have multiple members
- receive imports

Relationships:

- Project N:N Places
- Project N:N Users
- Project 1:N ItineraryDays
- Project 1:N Imports
- Project 1:N ChatSessions

Implemented through:

- project_places
- project_members

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
- Project 1:N Imports
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
- Project 1:N ChatSessions

---

## Itinerary System

Projects contain itinerary structures.

Relationships:

- Project 1:N ItineraryDays
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