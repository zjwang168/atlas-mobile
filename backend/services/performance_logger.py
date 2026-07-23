"""Pipeline performance metrics logging.

Provides PipelineMetrics dataclass for tracking end-to-end pipeline timing
and LLM token usage, plus global functions to record and query recent metrics.

Usage:
    metrics = PipelineMetrics()
    metrics.run_id = f"run_{int(time.time()*1000)}"
    metrics.t_request = time.time()
    # ... pipeline logic ...
    metrics.llm_calls.append({"call_name": "extraction", "input_tokens": 100, ...})
    metrics.t_parse_done = time.time()
    # ... more pipeline ...
    metrics.t_response = time.time()
    record_metrics(metrics)
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("atlas.performance")


@dataclass
class PipelineMetrics:
    """单次 pipeline 运行的性能指标。"""

    # 标识
    run_id: str = ""
    source_url: str = ""

    # 时间点（绝对时间戳）
    t_request: float = 0.0       # 收到请求
    t_parse_done: float = 0.0    # 文本解析/提取完成
    t_geocode_done: float = 0.0  # 地理编码完成
    t_response: float = 0.0      # 返回响应

    # Token 使用（每次 LLM 调用）
    llm_calls: list = field(default_factory=list)
    # [{call_name: str, input_tokens: int, output_tokens: int, duration_s: float}]

    # ── 派生指标（自动计算） ──────────────────────────────────────

    @property
    def total_duration_s(self) -> float:
        return self.t_response - self.t_request if self.t_response and self.t_request else 0.0

    @property
    def parse_duration_s(self) -> float:
        return self.t_parse_done - self.t_request if self.t_parse_done and self.t_request else 0.0

    @property
    def geocode_duration_s(self) -> float:
        if self.t_geocode_done and self.t_parse_done:
            return self.t_geocode_done - self.t_parse_done
        return 0.0

    @property
    def total_input_tokens(self) -> int:
        return sum(call.get("input_tokens", 0) for call in self.llm_calls)

    @property
    def total_output_tokens(self) -> int:
        return sum(call.get("output_tokens", 0) for call in self.llm_calls)

    # ── 方法 ──────────────────────────────────────────────────────

    def log(self):
        """输出格式化的日志记录。"""
        logger.info(
            "[PERF] run_id=%s | url=%s | total=%.1fs | parse=%.1fs | "
            "geocode=%.1fs | input_tokens=%s | output_tokens=%s | llm_calls=%s",
            self.run_id,
            self.source_url[:80],
            self.total_duration_s,
            self.parse_duration_s,
            self.geocode_duration_s,
            self.total_input_tokens,
            self.total_output_tokens,
            len(self.llm_calls),
        )
        # Also log each individual LLM call detail
        for i, call in enumerate(self.llm_calls):
            logger.info(
                "[PERF]   llm_call[%s] name=%s | in=%s | out=%s | dur=%.2fs",
                i,
                call.get("call_name", "?"),
                call.get("input_tokens", 0),
                call.get("output_tokens", 0),
                call.get("duration_s", 0.0),
            )

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "source_url": self.source_url,
            "total_duration_s": round(self.total_duration_s, 2),
            "parse_duration_s": round(self.parse_duration_s, 2),
            "geocode_duration_s": round(self.geocode_duration_s, 2),
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "llm_calls": self.llm_calls,
        }


# ── 全局 metrics 存储 ──────────────────────────────────────────

_recent_metrics: list[PipelineMetrics] = []
_MAX_RECENT_METRICS = 50


def record_metrics(metrics: PipelineMetrics):
    """记录 metrics 到日志并保存在内存列表中。"""
    metrics.log()
    _recent_metrics.append(metrics)
    if len(_recent_metrics) > _MAX_RECENT_METRICS:
        _recent_metrics.pop(0)


def get_recent_metrics(limit: int = 10) -> list[dict]:
    """返回最近的性能指标（用于 API 调试端点）。"""
    return [m.to_dict() for m in _recent_metrics[-limit:]]
