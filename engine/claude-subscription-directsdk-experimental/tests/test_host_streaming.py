"""The installed profile must opt in to Hermes' streaming dispatch (aqeelOS, 14 Nov 2026).

Without ``supports_streaming`` core runs an external-process provider through the buffered call, so a
web chat reply arrives in one piece at the end instead of as ``assistant.delta`` events while it is written.
"""
from types import SimpleNamespace


def test_profile_opts_into_streaming(profile):
    assert getattr(profile, "supports_streaming", None) is True


def test_profile_routes_through_host_streaming(profile):
    from agent.turn_api_call import _should_stream

    for consumers in (True, False):
        agent = SimpleNamespace(provider=profile.name, base_url=profile.base_url,
                                _disable_streaming=False, _has_stream_consumers=lambda c=consumers: c)
        assert _should_stream(agent) is True
    # a session or provider that turns streaming off still wins
    agent = SimpleNamespace(provider=profile.name, base_url=profile.base_url,
                            _disable_streaming=True, _has_stream_consumers=lambda: True)
    assert _should_stream(agent) is False
