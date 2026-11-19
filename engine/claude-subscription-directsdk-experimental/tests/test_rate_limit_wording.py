"""CH-1 (19 Nov 2026): Anthropic's short 429 "(not your usage limit)" was read by the engine as an empty account (billing,
never retried) and support customers' messages were dropped. The transport words it as a rate limit with the relay's hold time."""
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import directsdk  # noqa: E402

REAL = ("Incomplete upstream response (first upstream attempt: status 429, capture incomplete, native retries denied: 0, upstream said: "
        "upstream rate-limited 1 consecutive request(s) to api.anthropic.com; bili is holding outbound sends until 2026-11-19T13:37:09.465Z "
        "(~519s, exponential backoff) instead of amplifying, auto-resumes when the limit clears (#4204)): API Error: Server is temporarily "
        "limiting requests (not your usage limit)")
NOW = 1795095029.0  # 2026-11-19T13:30:29Z, 400 s before the hold ends


class RateLimitWording(unittest.TestCase):
    def test_hold_becomes_try_again_in(self):
        out = directsdk.rate_limit_wording(REAL, 429, now=NOW)
        self.assertTrue(out.startswith('Rate limit: the AI service asked to wait, try again in 401 seconds. '), out[:90])
        self.assertNotIn('usage limit', out.lower())
        self.assertIn('holding outbound sends until 2026-11-19T13:37:09.465Z', out)  # run-gates.mjs holdIn still finds it

    def test_no_hold_waits_a_minute(self):
        out = directsdk.rate_limit_wording('upstream said: Server is temporarily limiting requests (not your usage limit)', 429, now=NOW)
        self.assertTrue(out.startswith('Rate limit: the AI service asked to wait, try again in 60 seconds. '))

    def test_other_errors_untouched(self):
        for msg, status in (('Incomplete upstream response (first upstream attempt: status 500)', 500),
                            ("You've hit your session limit · resets 6pm (UTC)", None),
                            ('credit balance is too low', 402)):
            self.assertEqual(directsdk.rate_limit_wording(msg, status, now=NOW), msg)

    @unittest.skipUnless(os.environ.get('HERMES_AGENT_DIR'), 'set HERMES_AGENT_DIR to check against the engine classifier')
    def test_engine_reads_rate_limit(self):
        sys.path.insert(0, os.environ['HERMES_AGENT_DIR'])
        from agent import error_classifier as ec

        class E(Exception):
            status_code = 429

        before = ec.classify_api_error(E(REAL), provider='claude-subscription-directsdk-experimental', model='claude-sonnet-5-5')
        after = ec.classify_api_error(E(directsdk.rate_limit_wording(REAL, 429, now=NOW)),
                                      provider='claude-subscription-directsdk-experimental', model='claude-sonnet-5-5')
        self.assertEqual(before.reason.value, 'billing')  # the bug, as the engine has it today
        self.assertEqual(after.reason.value, 'rate_limit')
        self.assertTrue(after.retryable)


if __name__ == '__main__':
    unittest.main()
