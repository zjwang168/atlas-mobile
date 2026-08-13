"""
Supabase integration for long-term conversation persistence.

Handles CRUD operations for:
- conversations: title, source_url, metadata
- conversation_messages: role, content, tool_calls, tool_results
- conversation_locations: name, lat, lng, hierarchy_level, is_active
- conversation_summaries: rolling compressed chat context

Uses the existing supabaseClient from the frontend (same project reference).
Environment variables: SUPABASE_URL, SUPABASE_ANON_KEY (from .env)
"""

import json
import os
import uuid
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv

# Load .env from project root
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')
load_dotenv(dotenv_path)


class SupabaseService:
    """Supabase CRUD for conversation persistence."""

    MEMORY_TOTAL_LIMIT = 80
    MEMORY_PER_CATEGORY_LIMIT = 16
    MEMORY_ARCHIVE_BATCH = 20
    MEMORY_PRIORITY = {
        "profile": 0,
        "preference": 1,
        "interest": 2,
        "constraint": 3,
        "visited_place": 4,
        "plan": 5,
        "disliked": 6,
        "old_memory": 99,
    }

    def __init__(self):
        self._client = None
        self._initialized = False

    def _get_client(self):
        """Lazy initialize Supabase client, then act as the calling user.

        If the request carries a user JWT (see request_context / the FastAPI
        middleware), PostgREST calls run with that identity so RLS policies
        (user_id = auth.uid()) resolve to the real user. Without a token we
        fall back to the anon role — reads/writes on RLS-protected tables
        will then be refused, which is the intended fail-closed behavior.
        """
        if not self._initialized:
            try:
                from supabase import create_client
                url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
                key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")

                if url and key:
                    self._client = create_client(url, key)
                    self._initialized = True
                else:
                    print("[SupabaseService] SUPABASE_URL or SUPABASE_ANON_KEY not set")
                    self._client = None
            except ImportError:
                print("[SupabaseService] supabase package not installed")
                self._client = None
            except Exception as e:
                print(f"[SupabaseService] Init error: {e}")
                self._client = None

        if self._client is not None:
            try:
                from backend.services.request_context import get_user_token
                token = get_user_token()
                key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
                # Use the user's JWT when present; otherwise reset to anon.
                self._client.postgrest.auth(token or key)
            except Exception:
                pass
        return self._client

    async def save_conversation(self, session) -> str:
        """Save a session to Supabase. Returns conversation_id."""
        client = self._get_client()
        if not client:
            raise ConnectionError("Supabase client not available")

        conversation_id = session.conversation_id or str(uuid.uuid4())

        import asyncio

        existing_location_count = None
        try:
            existing_result = await asyncio.to_thread(
                lambda: client.table("conversations")
                    .select("location_count")
                    .eq("id", conversation_id)
                    .execute()
            )
            if existing_result.data:
                existing_location_count = existing_result.data[0].get("location_count")
        except Exception:
            existing_location_count = None

        # Upsert conversation
        conv_data = {
            "id": conversation_id,
            "title": session.title or "Untitled",
            "source_url": session.source_url,
            "source_type": session.source_type,
            # Preserve the original location count shown in the chat card.
            # Chat follow-ups may add more pins to the session, but we do not
            # want the historical card count to drift upward just because the
            # user asked for nearby suggestions.
            "location_count": existing_location_count if existing_location_count is not None else len(session.locations),
            "message_count": len(session.messages),
            "inferred_region": session.inferred_region,
            "updated_at": datetime.utcnow().isoformat(),
        }

        try:
            # Use synchronous client via asyncio.to_thread
            await asyncio.to_thread(
                lambda: client.table("conversations").upsert(conv_data).execute()
            )
        except Exception as e:
            print(f"[SupabaseService] Failed to save conversation: {e}")
            raise

        # Delete existing messages and locations before re-saving
        try:
            await asyncio.to_thread(
                lambda: client.table("conversation_messages")
                    .delete()
                    .eq("conversation_id", conversation_id)
                    .execute()
            )
            await asyncio.to_thread(
                lambda: client.table("conversation_locations")
                    .delete()
                    .eq("conversation_id", conversation_id)
                    .execute()
            )
        except Exception as e:
            print(f"[SupabaseService] Cleanup error: {e}")

        # Save new messages
        if session.messages:
            await self._save_messages(client, conversation_id, session.messages)

        # Save new locations
        if session.locations:
            await self._save_locations(client, conversation_id, session.locations)

        return conversation_id

    async def save_places(self, places: list[dict], source_url: str | None = None, region: str | None = None) -> list[dict]:
        """Persist places to the My Places tables, deduping against existing rows."""
        client = self._get_client()
        if not client:
            raise ConnectionError("Supabase client not available")

        import asyncio

        existing_result = await asyncio.to_thread(
            lambda: client.table("places")
                .select("id, name, subtitle, category, latitude, longitude, region, created_at")
                .execute()
        )
        existing = existing_result.data or []

        def normalize(value: str) -> str:
            return (value or "").strip().lower()

        def same_place(a: dict, b: dict) -> bool:
            name_a = normalize(a.get("name", ""))
            name_b = normalize(b.get("name", ""))
            coord_match = (
                abs(float(a.get("latitude", 0)) - float(b.get("latitude", 0))) < 0.001
                and abs(float(a.get("longitude", 0)) - float(b.get("longitude", 0))) < 0.001
            )
            name_match = bool(name_a and name_b and (name_a in name_b or name_b in name_a))
            return name_match or coord_match

        to_insert = []
        for place in places:
            if not place.get("name"):
                continue
            if any(same_place(place, row) for row in existing):
                continue
            to_insert.append({
                "name": place.get("name", ""),
                "subtitle": place.get("subtitle") or place.get("full_address") or place.get("description") or None,
                "category": place.get("category") if place.get("category") not in (None, "", "Place") else None,
                "latitude": place.get("latitude", 0),
                "longitude": place.get("longitude", 0),
                "region": region,
            })

        if not to_insert:
            return []

        inserted = await asyncio.to_thread(
            lambda: client.table("places").insert(to_insert).execute()
        )
        rows = inserted.data or []

        if inserted.error:
            print(f"[SupabaseService] bulk place insert failed, falling back to row-by-row: {inserted.error}")
            rows = []
            for row in to_insert:
                try:
                    single = await asyncio.to_thread(
                        lambda row=row: client.table("places").insert(row).execute()
                    )
                    if single.error:
                        print(f"[SupabaseService] row insert failed, skipping row: {single.error} | row={row}")
                        continue
                    rows.extend(single.data or [])
                except Exception as e:
                    print(f"[SupabaseService] row insert exception, skipping row: {e} | row={row}")
                    continue

            if not rows:
                raise ValueError(getattr(inserted.error, "message", str(inserted.error)))

        if source_url and rows:
            source_rows = [{
                "place_id": row["id"],
                "source_type": "chat",
                "source_url": source_url,
            } for row in rows]
            try:
                await asyncio.to_thread(
                    lambda: client.table("place_sources").insert(source_rows).execute()
                )
            except Exception as e:
                print(f"[SupabaseService] place_sources insert warning: {e}")

        return rows

    async def save_conversation_summary(
        self,
        conversation_id: str,
        summary: str,
        start_message_index: int,
        end_message_index: int,
    ) -> bool:
        """Persist a rolling summary snapshot for a conversation."""
        client = self._get_client()
        if not client:
            return False

        import asyncio
        import uuid

        record = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "summary": summary,
            "start_message_index": start_message_index,
            "end_message_index": end_message_index,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        try:
            await asyncio.to_thread(
                lambda: client.table("conversation_summaries").insert(record).execute()
            )
            return True
        except Exception as e:
            print(f"[SupabaseService] save_conversation_summary error: {e}")
            return False

    async def load_conversation(self, conversation_id: str):
        """Load a conversation from Supabase. Returns a Session object."""
        client = self._get_client()
        if not client:
            raise ConnectionError("Supabase client not available")

        import asyncio

        from backend.services.conversation_manager import Session

        # Load conversation
        conv_result = await asyncio.to_thread(
            lambda: client.table("conversations").select("*").eq("id", conversation_id).execute()
        )

        if not conv_result.data:
            # Some deployments can still return the row via the list endpoint
            # even when the direct id lookup comes back empty. Fall back to a
            # small in-memory search over the conversation list before giving up.
            list_result = await self.list_conversations()
            conv_match = next((row for row in list_result if row.get("id") == conversation_id), None)
            if not conv_match:
                raise ValueError(f"Conversation {conversation_id} not found")
            conv = conv_match
        else:
            conv = conv_result.data[0]

        # Load messages
        msg_result = await asyncio.to_thread(
            lambda: client.table("conversation_messages")
                .select("*")
                .eq("conversation_id", conversation_id)
                .order("message_index")
                .execute()
        )

        # Load locations
        loc_result = await asyncio.to_thread(
            lambda: client.table("conversation_locations")
                .select("*")
                .eq("conversation_id", conversation_id)
                .eq("is_active", True)
                .execute()
        )

        # Load latest summary
        summary_result = await asyncio.to_thread(
            lambda: client.table("conversation_summaries")
                .select("*")
                .eq("conversation_id", conversation_id)
                .order("end_message_index", desc=True)
                .limit(1)
                .execute()
        )

        # Reconstruct session using the conversation id as the stable session id.
        # This keeps the chat identifier deterministic across reloads and avoids
        # the frontend/backend id split that caused restore mismatches.
        session = Session(session_id=conversation_id)
        session.conversation_id = conversation_id
        session.source_url = conv.get("source_url")
        session.source_type = conv.get("source_type")
        session.title = conv.get("title", "")
        session.inferred_region = conv.get("inferred_region")
        session.pending_place_action = conv.get("pending_place_action")
        if summary_result.data:
            latest_summary = summary_result.data[0]
            session.conversation_summary = latest_summary.get("summary", "")
            session.summary_message_count = latest_summary.get("end_message_index", 0) or 0

        # Reconstruct messages
        for msg in msg_result.data or []:
            session.messages.append({
                "role": msg["role"],
                "content": msg["content"],
                "tool_calls": msg.get("tool_calls"),
                "tool_results": msg.get("tool_results"),
                "timestamp": msg.get("created_at", ""),
            })

        # Reconstruct locations
        for loc in loc_result.data or []:
            session.locations.append({
                "name": loc["name"],
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "full_address": loc.get("full_address", ""),
                "hierarchy_level": loc.get("hierarchy_level", 2),
                "sentiment": loc.get("sentiment"),
                "description": loc.get("description"),
                "category": loc.get("category"),
            })

        return session

    async def load_latest_conversation_summary(self, conversation_id: str) -> str:
        client = self._get_client()
        if not client:
            return ""

        import asyncio

        result = await asyncio.to_thread(
            lambda: client.table("conversation_summaries")
                .select("summary")
                .eq("conversation_id", conversation_id)
                .order("end_message_index", desc=True)
                .limit(1)
                .execute()
        )
        if result.data:
            return result.data[0].get("summary", "") or ""
        return ""

    async def list_conversations(self, user_id: str = None) -> list:
        """List all saved conversations."""
        client = self._get_client()
        if not client:
            return []

        import asyncio

        query = client.table("conversations").select(
            "id, title, source_url, source_type, location_count, message_count, created_at, updated_at"
        )

        if user_id:
            query = query.eq("user_id", user_id)

        query = query.order("updated_at", desc=True).limit(50)

        result = await asyncio.to_thread(lambda: query.execute())
        conversations = result.data or []
        summaries = []
        try:
            summary_result = await asyncio.to_thread(
                lambda: client.table("conversation_summaries")
                    .select("conversation_id, summary, end_message_index, updated_at")
                    .order("end_message_index", desc=True)
                    .execute()
            )
            summaries = summary_result.data or []
        except Exception:
            summaries = []

        latest_by_conv: dict[str, dict] = {}
        for row in summaries:
            conv_id = row.get("conversation_id")
            if conv_id and conv_id not in latest_by_conv:
                latest_by_conv[conv_id] = row

        for conv in conversations:
            latest = latest_by_conv.get(conv.get("id"))
            if latest:
                conv["latest_summary"] = latest.get("summary", "")
                conv["summary_end_message_index"] = latest.get("end_message_index", 0)
            else:
                conv["latest_summary"] = ""
                conv["summary_end_message_index"] = 0
        return conversations

    async def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation and all related data through FK cascades."""
        client = self._get_client()
        if not client:
            return False

        import asyncio

        try:
            result = await asyncio.to_thread(
                lambda: client.table("conversations")
                    .delete()
                    .eq("id", conversation_id)
                    .select("id")
                    .execute()
            )
            return bool(result.data)
        except Exception as e:
            print(f"[SupabaseService] Delete error: {e}")
            return False

    async def _save_messages(self, client, conversation_id: str, messages: list):
        """Save messages batch."""
        import asyncio

        records = []
        for i, msg in enumerate(messages):
            records.append({
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "role": msg["role"],
                "content": msg["content"],
                "tool_calls": json.dumps(msg.get("tool_calls")) if msg.get("tool_calls") else None,
                "tool_results": json.dumps(msg.get("tool_results")) if msg.get("tool_results") else None,
                "message_index": i,
                "created_at": datetime.utcnow().isoformat(),
            })

        if records:
            await asyncio.to_thread(
                lambda: client.table("conversation_messages").upsert(records).execute()
            )

    async def _save_locations(self, client, conversation_id: str, locations: list):
        """Save locations batch."""
        import asyncio

        records = []
        for loc in locations:
            records.append({
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "name": loc.get("name", ""),
                "latitude": loc.get("latitude", 0),
                "longitude": loc.get("longitude", 0),
                "full_address": loc.get("full_address", ""),
                "hierarchy_level": loc.get("hierarchy_level", 2),
                "is_active": True,
                "sentiment": loc.get("sentiment"),
                "description": loc.get("description"),
                "category": loc.get("category"),
                "created_at": datetime.utcnow().isoformat(),
            })

        if records:
            await asyncio.to_thread(
                lambda: client.table("conversation_locations").upsert(records).execute()
            )

    # ---- Long-term Memory Operations ----

    async def save_memory(self, session_id: str, key: str, value: str, category: str = "preference") -> bool:
        """Save a memory item - delete existing with same key first, then insert."""
        client = self._get_client()
        if not client:
            return False

        import asyncio
        import uuid

        try:
            # Delete existing memory with same key
            await asyncio.to_thread(
                lambda: client.table("long_term_memory")
                    .delete()
                    .eq("key", key)
                    .execute()
            )
            # Insert new — note: session_id column may not exist in the table,
            # so we omit it and pass session_id as part of the value metadata
            memory_record = {
                "id": str(uuid.uuid4()),
                "key": key,
                "value": value,
                "category": category,
                "updated_at": datetime.utcnow().isoformat(),
            }
            await asyncio.to_thread(
                lambda: client.table("long_term_memory").insert(memory_record).execute()
            )

            await self._prune_memory_entries(client)
            return True
        except Exception as e:
            print(f"[SupabaseService] save_memory error: {e}")
            return False

    async def list_memories(self, user_id: str = None) -> list:
        """List all long-term memories, optionally filtered by user_id."""
        client = self._get_client()
        if not client:
            return []

        import asyncio

        try:
            query = client.table("long_term_memory").select("*")

            if user_id:
                query = query.eq("user_id", user_id)

            query = query.order("updated_at", desc=True).limit(self.MEMORY_TOTAL_LIMIT + 8)

            result = await asyncio.to_thread(lambda: query.execute())
            memories = result.data or []
            memories.sort(
                key=lambda item: (
                    self.MEMORY_PRIORITY.get(str(item.get("category") or "preference"), 50),
                    -(self._parse_ts(item.get("updated_at"))),
                    str(item.get("key") or ""),
                )
            )
            old_memories = [m for m in memories if str(m.get("category") or "") == "old_memory"]
            active_memories = [m for m in memories if str(m.get("category") or "") != "old_memory"]
            return old_memories[:1] + active_memories[:self.MEMORY_TOTAL_LIMIT - 1]
        except Exception as e:
            print(f"[SupabaseService] list_memories error: {e}")
            return []

    @staticmethod
    def _parse_ts(value: object) -> float:
        if not value:
            return 0.0
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    async def _prune_memory_entries(self, client) -> None:
        """Keep active long-term memory bounded and archive overflow into old_memory."""
        import asyncio

        try:
            result = await asyncio.to_thread(
                lambda: client.table("long_term_memory")
                    .select("id, key, value, category, updated_at")
                    .order("updated_at", desc=True)
                    .execute()
            )
            rows = result.data or []
            if not rows:
                return

            old_memory_rows = [row for row in rows if str(row.get("category") or "") == "old_memory"]
            active_rows = [row for row in rows if str(row.get("category") or "") != "old_memory"]

            if len(active_rows) > self.MEMORY_TOTAL_LIMIT:
                overflow = active_rows[self.MEMORY_TOTAL_LIMIT:]
                await self._archive_overflow_memory(client, overflow, existing_old_memory=old_memory_rows[:1])
                active_rows = active_rows[:self.MEMORY_TOTAL_LIMIT]

            keep_ids: set[str] = set()
            category_counts: dict[str, int] = {}
            ordered_rows = sorted(
                active_rows,
                key=lambda item: (
                    self.MEMORY_PRIORITY.get(str(item.get("category") or "preference"), 50),
                    -(self._parse_ts(item.get("updated_at"))),
                    str(item.get("key") or ""),
                ),
            )
            for row in ordered_rows:
                category = str(row.get("category") or "preference")
                current_count = category_counts.get(category, 0)
                if current_count >= self.MEMORY_PER_CATEGORY_LIMIT:
                    continue
                if len(keep_ids) >= self.MEMORY_TOTAL_LIMIT:
                    break
                row_id = row.get("id")
                if not row_id:
                    continue
                keep_ids.add(str(row_id))
                category_counts[category] = current_count + 1

            drop_ids = [str(row.get("id")) for row in active_rows if str(row.get("id") or "") not in keep_ids and row.get("id")]
            if drop_ids:
                await asyncio.to_thread(
                    lambda: client.table("long_term_memory")
                        .delete()
                        .in_("id", drop_ids)
                        .execute()
                )
        except Exception as e:
            print(f"[SupabaseService] prune_memory_entries warning: {e}")

    async def _archive_overflow_memory(self, client, overflow_rows: list[dict], existing_old_memory: list[dict] | None = None) -> None:
        """Compress overflow memories into the old_memory bucket."""
        import asyncio

        if not overflow_rows:
            return

        existing_summary = ""
        if existing_old_memory:
            existing_summary = str(existing_old_memory[0].get("value") or "").strip()

        chunk_lines = []
        for row in overflow_rows[: self.MEMORY_ARCHIVE_BATCH]:
            category = str(row.get("category") or "preference")
            key = str(row.get("key") or "memory")
            value = str(row.get("value") or "").strip()
            if not value:
                continue
            chunk_lines.append(f"- {category}: {key} = {value}")

        if not chunk_lines:
            return

        summary_prompt = f"""You are compressing a travel assistant's long-term memory.

Merge the previous archive summary with the new memory items into ONE concise English sentence block.
Preserve durable user preferences, visited places, dislikes, constraints, and plans.
Do not invent facts.
Keep the result compact but useful for future travel recommendations.

Previous archive summary:
{existing_summary or "N/A"}

New memory items:
{chr(10).join(chunk_lines)}
"""

        try:
            from backend.services.llm_client import call_llm

            result = await asyncio.to_thread(
                call_llm,
                messages=[{"role": "system", "content": summary_prompt}],
                temperature=0.1,
                max_tokens=220,
            )
            compressed = str(result.get("content", "")).strip()
        except Exception:
            compressed = ""

        if not compressed:
            compressed = " ".join(line[2:] for line in chunk_lines[:5])

        if existing_old_memory:
            old_id = str(existing_old_memory[0].get("id"))
            try:
                await asyncio.to_thread(
                    lambda: client.table("long_term_memory")
                        .delete()
                        .eq("id", old_id)
                        .execute()
                )
            except Exception:
                pass

        record = {
            "id": str(uuid.uuid4()),
            "key": "user.old_memory",
            "value": compressed,
            "category": "old_memory",
            "updated_at": datetime.utcnow().isoformat(),
        }
        try:
            await asyncio.to_thread(
                lambda: client.table("long_term_memory").insert(record).execute()
            )
        except Exception as e:
            print(f"[SupabaseService] archive_overflow_memory error: {e}")
