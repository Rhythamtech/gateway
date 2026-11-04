"""Pure token-usage normalization for provider-reported usage payloads.

These helpers convert provider usage objects (OpenAI- and Anthropic-shaped)
into the normalized token components stored on call traces:

* ``uncached_input`` — uncache'd prompt/input tokens,
* ``cache_read`` / ``cache_write`` — cache traffic (mutually exclusive
  components; cached input is never also counted as uncached input),
* ``output`` — completion/output tokens.

Canonical totals are derived per attempt: ``input_tokens`` is the sum of the
three input components (each cache token counted once) and ``cache_tokens``
is the sum of read + write traffic.
"""

class TokenUsage:
    """Normalized token components; any component may be missing (None)."""

    __slots__ = ("uncached_input", "cache_read", "cache_write", "output")

    def __init__(
        self,
        *,
        uncached_input: int | None = None,
        cache_read: int | None = None,
        cache_write: int | None = None,
        output: int | None = None,
    ):
        self.uncached_input = uncached_input
        self.cache_read = cache_read
        self.cache_write = cache_write
        self.output = output


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value >= 0 else None


def normalize_openai_usage(usage: dict) -> TokenUsage:
    prompt_details = usage.get("prompt_tokens_details")
    prompt_details = prompt_details if isinstance(prompt_details, dict) else {}
    cached = _int_or_none(prompt_details.get("cached_tokens"))
    prompt = _int_or_none(usage.get("prompt_tokens"))
    completion = _int_or_none(usage.get("completion_tokens"))

    uncached = None
    if prompt is not None:
        uncached = max(0, prompt - (cached or 0))

    return TokenUsage(
        uncached_input=uncached,
        cache_read=cached,
        cache_write=None,  # OpenAI reports no cache writes
        output=completion,
    )


def normalize_anthropic_usage(usage: dict) -> TokenUsage:
    return TokenUsage(
        uncached_input=_int_or_none(usage.get("input_tokens")),
        cache_read=_int_or_none(usage.get("cache_read_input_tokens")),
        cache_write=_int_or_none(usage.get("cache_creation_input_tokens")),
        output=_int_or_none(usage.get("output_tokens")),
    )


def normalize_provider_usage(usage: dict, protocol: str) -> TokenUsage:
    if protocol == "anthropic":
        return normalize_anthropic_usage(usage)
    return normalize_openai_usage(usage)


def canonical_input_tokens(usage: TokenUsage) -> int | None:
    """Total input as the sum of the three input components (cache once)."""

    components = (usage.uncached_input, usage.cache_read, usage.cache_write)
    if all(component is None for component in components):
        return None
    return sum(component or 0 for component in components)


def total_cache_tokens(usage: TokenUsage) -> int | None:
    """Total cache traffic (read + write), matching ``cache_tokens``."""

    components = (usage.cache_read, usage.cache_write)
    if all(component is None for component in components):
        return None
    return sum(component or 0 for component in components)
