"""LLM gateway: OpenAI, OpenAI Responses, and Anthropic Messages endpoints.

NOTE: /v1/* is currently unauthenticated. Planned: users generate per-user API
keys and present them as `Authorization: Bearer <key>`; validate against the
users table before these routes go public.
"""
