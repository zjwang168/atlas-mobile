# OurAtlas Team Meeting Agenda

---

## Brand & Infrastructure

| | |
|---|---|
| **Official Brand** | OurAtlas |
| **Domain** | ouratlas.app |
| **Admin Email** | admin@ouratlas.app |
| **Company Email** | @ouratlas.app |
| **GitHub Organization** | OurAtlas |
| **LinkedIn Page** | OurAtlas |

---

## 1. Project Status Update

Quick updates on:

- Domain purchase
- Company email setup – Google Workplace
- Supabase setup
- GitHub organization
- Current app progress

---

## 2. Define MVP Scope

Before assigning work, align on what Version 1 should include.

### Core Feature 1 — Import Anything

**User can:**
- Paste a link
- Paste text
- Upload an image

**Atlas extracts:**
- Places
- Notes
- Metadata

### Core Feature 2 — Map Experience

**User can:**
- View saved places
- Click map markers
- Open place detail sheets

### Core Feature 3 — Collections

**User can:**
- Save places
- Organize places
- Create collections

### Core Feature 4 — Profile & Settings

**User can:**
- View profile
- Manage settings
- Manage collections

---

## 3. Assign Feature Owners

### Feature 1 — Import Flow

| | |
|---|---|
| **Owner** | Product + AI |
| **Support** | Backend, Data / QA |

**Goal:** Users can paste a link, text, or upload an image, and OurAtlas can extract places from it.

**Related Files:**
- `src/features/import/ImportScreen.tsx`
- `src/features/import/PreviewScreen.tsx`
- `src/services/importService.ts`
- `src/services/aiService.ts`
- `src/types/import.ts`

**Deliverables:**
- [ ] Import UX
- [ ] AI extraction flow
- [ ] Prompt design
- [ ] Structured output format
- [ ] Preview before saving
- [ ] Basic testing

---

### Feature 2 — Backend & AI Extraction

| | |
|---|---|
| **Owner** | Backend Engineer |
| **Support** | Product + AI |

**Goal:** Connect the app with AI and Supabase so extracted places can be processed and saved.

**Related Files:**
- `src/services/aiService.ts`
- `src/services/importService.ts`
- `src/services/supabaseClient.ts`
- `src/services/placeService.ts`
- Backend API / FastAPI files

**Deliverables:**
- [ ] FastAPI endpoints
- [ ] Claude / OpenAI integration
- [ ] Authentication
- [ ] Supabase integration
- [ ] Error handling
- [ ] Rate limiting

---

### Feature 3 — Map Experience

| | |
|---|---|
| **Owner** | iOS Engineer |
| **Support** | Product + AI |

**Goal:** Users can view saved places on a map and interact with markers and sheets.

**Related Files:**
- `src/features/home/HomeScreen.tsx`
- `src/components/map/PlaceMarker.tsx`
- `src/components/map/MapBottomSheet.tsx`
- `src/features/place/PlaceDetailScreen.tsx`

**Deliverables:**
- [ ] Map interactions
- [ ] Place markers
- [ ] Bottom sheet
- [ ] Place detail sheet
- [ ] Transitions
- [ ] Animations

---

### Feature 4 — Places, Collections & Profile

| | |
|---|---|
| **Owner** | iOS Engineer |
| **Support** | Backend Engineer |

**Goal:** Users can save places, organize them into collections, and view profile/settings.

**Related Files:**
- `src/features/place/PlaceDetailScreen.tsx`
- `src/features/collections/CollectionsScreen.tsx`
- `src/features/collections/CollectionDetailScreen.tsx`
- `src/features/profile/ProfileScreen.tsx`
- `src/services/placeService.ts`
- `src/types/place.ts`
- `src/types/collection.ts`
- `src/types/user.ts`

**Deliverables:**
- [ ] Place detail page
- [ ] Collection UI
- [ ] Collection detail page
- [ ] Profile UI
- [ ] Settings
- [ ] Saved places logic

---

### Feature 5 — AI Evaluation & QA

| | |
|---|---|
| **Owner** | Data / AI / Research |

**Goal:** Make sure AI extraction results are accurate, useful, and consistent.

**Related Files:**
- `src/services/aiService.ts`
- `src/types/import.ts`
- Test cases / evaluation docs

**Deliverables:**
- [ ] Prompt testing
- [ ] Weird input testing
- [ ] Extraction quality review
- [ ] Category validation
- [ ] Place metadata validation
- [ ] UX feedback

---

## 4. Demo Goals for Next Meeting

Everyone should leave with a concrete demo goal.

**Examples:**
- [ ] Login flow works
- [ ] Import extracts places successfully
- [ ] Map displays markers
- [ ] Collection creation works
- [ ] Profile page is functional
