"""Conversation session and persistence support.

Persisted conversations are product history, not long-term user memory. The
plain chat baseline uses only a bounded window from its own active session.
Legacy summary and memory fields remain here solely so old database rows can
still be loaded without a migration; the chat path does not read or write them.
"""

import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Session:
    """Represents an active chat session in memory."""
    session_id: str
    conversation_id: Optional[str] = None  # Supabase ID after persistence
    source_url: Optional[str] = None
    source_type: Optional[str] = None  # "reddit", "generic"
    title: str = ""

    # Messages: list of {"role", "content", "tool_calls", "tool_results", "timestamp"}
    messages: list = field(default_factory=list)
    # Legacy fields kept for backwards-compatible reads of existing rows.
    conversation_summary: str = ""
    summary_message_count: int = 0
    last_summary_at: float = 0.0
    user_memory_summary: str = ""
    pending_place_action: Optional[dict] = None
    # Ephemeral AI-agent state. It is deliberately kept separate from saved
    # Atlas data: a model may propose an action, but only the mobile client can
    # confirm and persist it through the normal domain services.
    user_location: Optional[tuple[float, float]] = None
    chat_presentation: Optional[dict] = None
    pending_chat_action: Optional[dict] = None
    # Sent by the authenticated mobile read model on each chat turn. It is
    # request-scoped user data, never inferred or persisted as model memory.
    special_places: list = field(default_factory=list)

    # Extracted data
    locations: list = field(default_factory=list)  # GeocodedLocation dicts
    removed_noise: list = field(default_factory=list)
    removed_hierarchy: list = field(default_factory=list)
    route: Optional[dict] = None
    inferred_region: Optional[str] = None
    is_multi_region: bool = False

    # Metadata
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def add_message(self, role: str, content: str, tool_calls=None, tool_results=None):
        """Add a message to the conversation."""
        self.messages.append({
            "role": role,
            "content": content,
            "tool_calls": tool_calls,
            "tool_results": tool_results,
            "timestamp": time.time(),
        })
        self.updated_at = time.time()

    def get_recent_context(self, max_messages: int = 10) -> list[dict]:
        """Get recent messages for LLM context (system + last N messages)."""
        return self.messages[-max_messages:]

    def to_dict(self) -> dict:
        """Serialize session to dict for API responses."""
        return {
            "session_id": self.session_id,
            "conversation_id": self.conversation_id,
            "source_url": self.source_url,
            "source_type": self.source_type,
            "title": self.title,
            "locations": self.locations,
            "route": self.route,
            "conversation_summary": self.conversation_summary,
            "summary_message_count": self.summary_message_count,
            "user_memory_summary": self.user_memory_summary,
            "pending_place_action": self.pending_place_action,
            "user_location": self.user_location,
            "chat_presentation": self.chat_presentation,
            "pending_chat_action": self.pending_chat_action,
            "removed_noise": self.removed_noise,
            "removed_hierarchy": self.removed_hierarchy,
            "inferred_region": self.inferred_region,
            "is_multi_region": self.is_multi_region,
            "message_count": len(self.messages),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def summary(self) -> dict:
        """Short summary for conversation list display."""
        return {
            "session_id": self.session_id,
            "conversation_id": self.conversation_id,
            "title": self.title,
            "source_url": self.source_url,
            "location_count": len(self.locations),
            "message_count": len(self.messages),
            "summary_message_count": self.summary_message_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class ConversationManager:
    """
    Manages session memory and long-term persistence.

    Session memory: In-memory dict keyed by session_id.
    Long-term memory: Supabase (via supabase_service.py).
    """

    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._supabase_service = None  # Lazy init

    def _get_supabase(self):
        """Lazy initialize Supabase service."""
        if self._supabase_service is None:
            try:
                from backend.services.supabase_service import SupabaseService
                self._supabase_service = SupabaseService()
            except ImportError:
                self._supabase_service = None
        return self._supabase_service

    # ---- Session Management ----

    def create_session(self, session_id: Optional[str] = None) -> Session:
        """Create a new session in memory."""
        if session_id is None:
            session_id = str(uuid.uuid4())

        session = Session(session_id=session_id)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        """Get session by ID from memory."""
        return self._sessions.get(session_id)

    def update_session(self, session_id: str, **kwargs) -> Optional[Session]:
        """Update session properties."""
        session = self.get_session(session_id)
        if session:
            for key, value in kwargs.items():
                if hasattr(session, key):
                    setattr(session, key, value)
            session.updated_at = time.time()
        return session

    def add_message(self, session_id: str, role: str, content: str,
                    tool_calls=None, tool_results=None) -> Optional[Session]:
        """Add a message to a session."""
        session = self.get_session(session_id)
        if session:
            session.add_message(role, content, tool_calls, tool_results)
        return session

    def delete_session(self, session_id: str) -> bool:
        """Remove session from memory."""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False

    def list_sessions(self) -> list[dict]:
        """List all active sessions as summaries."""
        return [s.summary() for s in self._sessions.values()]

    def get_context(self, session_id: str, max_messages: int = 10) -> list[dict]:
        """Get messages for LLM context window."""
        session = self.get_session(session_id)
        if session:
            return session.get_recent_context(max_messages)
        return []

    # ---- Legacy Long-term Memory API ----
    # These endpoints are retained for administrative compatibility. The
    # baseline chat intentionally never calls them.

    async def add_memory(self, session_id: str, key: str, value: str, category: str = "preference") -> bool:
        """Store a memory item (user preference, visited place, etc.).

        If the session exists in memory, also cache it there.
        If not, still persist directly to Supabase.
        """
        session = self.get_session(session_id)
        if session:
            # Store in session memory
            if not hasattr(session, 'memories'):
                session.memories = {}
            session.memories[key] = {"value": value, "category": category}

        # Persist to Supabase if available (works even without in-memory session)
        supabase = self._get_supabase()
        if supabase:
            try:
                await supabase.save_memory(session_id, key, value, category)
                return True
            except Exception as e:
                print(f"[ConversationManager] Failed to save memory: {e}")
                return False
        return False

    async def get_memories(self, session_id: str) -> dict:
        """Get all memories for a session."""
        session = self.get_session(session_id)
        if session and hasattr(session, 'memories'):
            return session.memories
        return {}

    async def get_all_memories(self, user_id: str = None) -> list:
        """Get all long-term memories from Supabase."""
        supabase = self._get_supabase()
        if supabase:
            try:
                return await supabase.list_memories(user_id)
            except Exception:
                return []
        return []

    async def save_conversation_summary(
        self,
        session_id: str,
        summary: str,
        start_message_index: int,
        end_message_index: int,
    ) -> bool:
        """Persist a rolling summary for a conversation."""
        session = self.get_session(session_id)
        if not session or not session.conversation_id:
            return False

        session.conversation_summary = summary
        session.summary_message_count = end_message_index
        session.last_summary_at = time.time()

        supabase = self._get_supabase()
        if supabase:
            try:
                await supabase.save_conversation_summary(
                    conversation_id=session.conversation_id,
                    summary=summary,
                    start_message_index=start_message_index,
                    end_message_index=end_message_index,
                )
                return True
            except Exception as e:
                print(f"[ConversationManager] Failed to save summary: {e}")
                return False
        return False

    async def load_latest_conversation_summary(self, conversation_id: str) -> str:
        supabase = self._get_supabase()
        if not supabase:
            return ""
        try:
            return await supabase.load_latest_conversation_summary(conversation_id)
        except Exception:
            return ""

    # ---- Long-term Persistence (Conversations) ----

    async def save_conversation(self, session_id: str) -> Optional[str]:
        """Save session to Supabase. Returns conversation_id."""
        session = self.get_session(session_id)
        if not session:
            return None

        supabase = self._get_supabase()
        if supabase:
            try:
                conv_id = await supabase.save_conversation(session)
                session.conversation_id = conv_id
                return conv_id
            except Exception as e:
                print(f"[ConversationManager] Failed to save to Supabase: {e}")
                return None
        return None

    async def load_conversation(self, conversation_id: str) -> Optional[Session]:
        """Load a conversation from Supabase into memory."""
        supabase = self._get_supabase()
        if supabase:
            try:
                session = await supabase.load_conversation(conversation_id)
                if session:
                    self._sessions[session.session_id] = session
                return session
            except Exception as e:
                print(f"[ConversationManager] Failed to load from Supabase: {e}")
                return None
        return None

    async def list_conversations(self, user_id: Optional[str] = None) -> list[dict]:
        """List saved conversations from Supabase."""
        supabase = self._get_supabase()
        if supabase:
            try:
                return await supabase.list_conversations(user_id)
            except Exception as e:
                print(f"[ConversationManager] Failed to list conversations: {e}")
                return []
        return []

    async def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation from Supabase."""
        supabase = self._get_supabase()
        if supabase:
            try:
                return await supabase.delete_conversation(conversation_id)
            except Exception as e:
                print(f"[ConversationManager] Failed to delete conversation: {e}")
                return False
        return False

    async def cleanup_expired_sessions(self, max_age_seconds: int = 3600):
        """Remove sessions older than max_age_seconds."""
        now = time.time()
        expired = [
            sid for sid, session in self._sessions.items()
            if now - session.updated_at > max_age_seconds
        ]
        for sid in expired:
            del self._sessions[sid]


# Module-level singleton
conversation_manager = ConversationManager()
