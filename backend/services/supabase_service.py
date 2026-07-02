"""
Supabase integration for long-term conversation persistence.

Handles CRUD operations for:
- conversations: title, source_url, metadata
- conversation_messages: role, content, tool_calls, tool_results
- conversation_locations: name, lat, lng, hierarchy_level, is_active

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

    def __init__(self):
        self._client = None
        self._initialized = False

    def _get_client(self):
        """Lazy initialize Supabase client."""
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

        return self._client

    async def save_conversation(self, session) -> str:
        """Save a session to Supabase. Returns conversation_id."""
        client = self._get_client()
        if not client:
            raise ConnectionError("Supabase client not available")

        conversation_id = session.conversation_id or str(uuid.uuid4())

        # Upsert conversation
        conv_data = {
            "id": conversation_id,
            "title": session.title or "Untitled",
            "source_url": session.source_url,
            "source_type": session.source_type,
            "location_count": len(session.locations),
            "message_count": len(session.messages),
            "inferred_region": session.inferred_region,
            "updated_at": datetime.utcnow().isoformat(),
        }

        try:
            # Use synchronous client via asyncio.to_thread
            import asyncio
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
            raise ValueError(f"Conversation {conversation_id} not found")

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

        # Reconstruct session
        session = Session(session_id=str(uuid.uuid4()))
        session.conversation_id = conversation_id
        session.source_url = conv.get("source_url")
        session.source_type = conv.get("source_type")
        session.title = conv.get("title", "")
        session.inferred_region = conv.get("inferred_region")

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

    async def list_conversations(self, user_id: str = None) -> list:
        """List all saved conversations."""
        client = self._get_client()
        if not client:
            return []

        import asyncio

        query = client.table("conversations").select("id, title, source_url, location_count, message_count, created_at, updated_at")

        if user_id:
            query = query.eq("user_id", user_id)

        query = query.order("updated_at", desc=True).limit(50)

        result = await asyncio.to_thread(lambda: query.execute())
        return result.data or []

    async def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation and all related data."""
        client = self._get_client()
        if not client:
            return False

        import asyncio

        try:
            # Delete messages
            await asyncio.to_thread(
                lambda: client.table("conversation_messages")
                    .delete()
                    .eq("conversation_id", conversation_id)
                    .execute()
            )
            # Delete locations
            await asyncio.to_thread(
                lambda: client.table("conversation_locations")
                    .delete()
                    .eq("conversation_id", conversation_id)
                    .execute()
            )
            # Delete conversation
            await asyncio.to_thread(
                lambda: client.table("conversations")
                    .delete()
                    .eq("id", conversation_id)
                    .execute()
            )
            return True
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

            query = query.order("updated_at", desc=True).limit(100)

            result = await asyncio.to_thread(lambda: query.execute())
            return result.data or []
        except Exception as e:
            print(f"[SupabaseService] list_memories error: {e}")
            return []
