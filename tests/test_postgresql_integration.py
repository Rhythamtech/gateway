"""PostgreSQL-only concurrency checks; set TEST_POSTGRES_URL to enable."""
import os
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.auth.models import User, UserRole
from backend.api_keys.models import APIKey
from backend.credits import service
from backend.credits.dtos import CreditAddition, ModelRateUpdate
from backend.gateway.providers.models import Provider
from backend.gateway.provider_models.models import ProviderModel
from backend.gateway.routing import RouteCandidate
from backend.core.errors import GatewayError
import backend.main  # noqa: F401 - register all models before creating the test schema


@pytest.fixture
def postgres_sessions(monkeypatch):
    url = os.getenv('TEST_POSTGRES_URL')
    if not url:
        pytest.skip('set TEST_POSTGRES_URL to run PostgreSQL integration tests')
    if url.startswith('postgresql://'):
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
    admin = create_engine(url)
    schema = 'test_' + uuid4().hex
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(service, 'SessionLocal', sessions)
    with sessions.begin() as db:
        db.add_all([User(id='u', email='u@example.com', hashed_password='x', role=UserRole.USER),
                    Provider(id='p', name='P', aliases='a', base_url='https://example.com', api_key='')])
        db.flush()
        db.add(ProviderModel(id='m', provider_id='p', model_name='m', model_id='a/m'))
    yield sessions
    engine.dispose()
    with admin.begin() as connection:
        connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
    admin.dispose()


def test_concurrent_reservations_and_settlement(postgres_sessions):
    addition = CreditAddition(credits=Decimal('20'), idempotency_key='fund-001', reason='test')
    service.add_credits('user', 'u', addition, 'u')
    service.add_credits('provider', 'p', addition, 'u')
    service.set_model_rate('m', ModelRateUpdate(tokens_per_credit=Decimal('10'), max_request_tokens=1000), 'u')
    candidate = RouteCandidate('a', 'p', 'm', 'm', None, 'openai')
    def reserve(i):
        try:
            return service.reserve_request_credits(candidate, 'u', 'key', str(i), 100, 100)
        except GatewayError:
            return None
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve, range(8)))
    reservations = [result for result in results if result]
    assert len(reservations) == 1
    usage_id = reservations[0].usage_id
    service.mark_dispatched(usage_id)
    service.record_usage(usage_id, 100, 100, None)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: service.settle_request_usage(usage_id), range(4)))
    with postgres_sessions() as db:
        for owner, owner_id in [('user', 'u'), ('provider', 'p')]:
            balance = service.get_balance(db, owner, owner_id)
            assert balance.remaining_credits == '0.000000'
            assert balance.reserved_credits == '0.000000'


def test_concurrent_rate_limit(postgres_sessions, monkeypatch):
    import hashlib
    from backend.api_keys.models import APIKey
    from backend.api_keys import middleware
    from starlette.responses import JSONResponse

    monkeypatch.setattr(middleware, 'SessionLocal', postgres_sessions)
    with postgres_sessions.begin() as db:
        db.get(User, 'u').tracing_enabled = True
        db.add(APIKey(id='key', owner_id='u', name='key', key_prefix='test',
                      key_hash=hashlib.sha256(b'secret').hexdigest()))
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda _: middleware.APIKeyAuthMiddleware._authenticate('/v1/models', 'secret'), range(70)))
    assert sum(not isinstance(result, JSONResponse) for result in results) == 60
    assert all(result.status_code == 429 for result in results if isinstance(result, JSONResponse))


def test_concurrent_idempotent_grant(postgres_sessions):
    addition = CreditAddition(credits=Decimal('20'), idempotency_key='same-grant', reason='test')
    with ThreadPoolExecutor(max_workers=6) as pool:
        entries = list(pool.map(lambda _: service.add_credits('user', 'u', addition, 'u'), range(6)))
    assert len({entry.id for entry in entries}) == 1
    with postgres_sessions() as db:
        assert service.get_balance(db, 'user', 'u').remaining_credits == '20.000000'


@pytest.mark.parametrize('stream', [False, True])
def test_inference_with_postgresql(postgres_sessions, monkeypatch, stream):
    import hashlib
    import httpx
    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.gateway import execution

    for module in ('backend.api_keys.middleware', 'backend.gateway.routing',
                   'backend.gateway.providers.service', 'backend.traces.service'):
        monkeypatch.setattr(f'{module}.SessionLocal', postgres_sessions)
    with postgres_sessions.begin() as db:
        db.get(User, 'u').tracing_enabled = True
        db.add(APIKey(id='key', owner_id='u', name='key', key_prefix='test',
                      key_hash=hashlib.sha256(b'secret').hexdigest()))
    addition = CreditAddition(credits=Decimal('1000'), idempotency_key='fund-001', reason='test')
    service.add_credits('user', 'u', addition, 'u')
    service.add_credits('provider', 'p', addition, 'u')
    service.set_model_rate('m', ModelRateUpdate(tokens_per_credit=Decimal('10'), max_request_tokens=1000), 'u')

    async def fake_provider(*args, **kwargs):
        if stream:
            return httpx.Response(200, content=(
                'data: {"id":"reply","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'
                'data: {"usage":{"prompt_tokens":10,"completion_tokens":2},"choices":[]}\n\n'
                'data: [DONE]\n\n'))
        return httpx.Response(200, json={'id': 'reply', 'object': 'chat.completion',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'hi'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 2}})
    monkeypatch.setattr(execution, 'call_provider', fake_provider)
    response = TestClient(app).post('/v1/chat/completions', headers={'x-api-key': 'secret'},
        json={'model': 'a/m', 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 20, 'stream': stream})
    assert response.status_code == 200, response.text
    with postgres_sessions() as db:
        usage = db.query(service.CreditUsage).one()
        assert usage.status == 'settled'
        assert (usage.input_tokens, usage.output_tokens) == (10, 2)
        from backend.traces import service as traces
        from backend.traces.models import LLMCallTrace
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).date()
        assert db.query(LLMCallTrace).count() == 1
        assert sum(row['successful_call_count'] for row in traces.hourly_call_activity(
            db, LLMCallTrace.user_id, 'u', today, today)) == 1
        assert traces.daily_charged_credits(db, service.CreditUsage.user_id, 'u', today, today)['totals']['charged_credits'] == '1.200000'

    if not stream:
        import time
        def make_request(_):
            start = time.monotonic()
            result = TestClient(app).post('/v1/chat/completions', headers={'x-api-key': 'secret'},
                json={'model': 'a/m', 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 20})
            return result.status_code, (time.monotonic() - start) * 1000
        with ThreadPoolExecutor(max_workers=20) as pool:
            results = list(pool.map(make_request, range(20)))
        assert all(status == 200 for status, _ in results)
        timings = sorted(elapsed for _, elapsed in results)
        print(f'PostgreSQL local, 20 concurrent requests: p50={timings[9]:.1f}ms p95={timings[18]:.1f}ms')
