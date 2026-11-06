"""Gemini through your Google AI subscription (Google AI Pro / Ultra), driven by the official Gemini CLI.

The CLI runs in ACP mode (``gemini --acp``) and only does the thinking: aqeelOS keeps the tools, approvals,
memory and chats, exactly like the Claude subscription. The engine's own ACP bridge drives it; that bridge
refuses every permission request the CLI makes, and the CLI's own shell and write tools are switched off in
~/.gemini/settings.json (aqeelOS writes that file), so Gemini never acts on the box by itself.

Sign in once with the Google account that has the subscription: aqeelOS runs ``gemini`` with the
"Login with Google" flow and shows the link and code (Models › Accounts).
"""

from typing import Any

from providers import register_provider
from providers.base import ProviderProfile


class GeminiSubscriptionProfile(ProviderProfile):
    """Gemini CLI over ACP: an external process, no REST models endpoint, auth owned by the CLI."""

    def create_client(self, **client_kwargs: Any) -> Any:
        from agent.copilot_acp_client import CopilotACPClient  # the engine's generic ACP stdio bridge

        if not client_kwargs.get("command") and not client_kwargs.get("acp_command"):
            from hermes_cli.auth import resolve_external_process_provider_credentials

            creds = resolve_external_process_provider_credentials(self.name)
            client_kwargs.setdefault("command", creds.get("command"))
            client_kwargs.setdefault("args", creds.get("args"))
        return CopilotACPClient(**client_kwargs)

    def fetch_models(self, *, api_key: str | None = None, base_url: str | None = None, timeout: float = 20.0) -> list[str] | None:
        """The models the signed-in account may use, from a short ACP session; None when that fails."""
        from hermes_cli.auth import resolve_external_process_provider_credentials

        try:
            creds = resolve_external_process_provider_credentials(self.name)
            client = self.create_client(api_key=creds.get("api_key"), base_url=creds.get("base_url"),
                                        command=creds.get("command"), args=creds.get("args"))
            return client.list_models(timeout_seconds=timeout) or None
        except Exception:
            return None


profile = GeminiSubscriptionProfile(
    name="gemini-subscription",
    aliases=("gemini-cli", "google-ai-pro"),
    display_name="Gemini (Google AI subscription)",
    description="Gemini through your Google AI Pro or Ultra plan, via the official Gemini CLI",
    signup_url="https://one.google.com/about/ai-premium",
    api_mode="chat_completions",
    env_vars=(),
    base_url="acp://gemini",
    auth_type="external_process",
    supports_health_check=False,
    process_command="gemini",
    process_args=("--acp",),
    process_command_env_vars=("GEMINI_SUBSCRIPTION_COMMAND",),
    process_args_env_var="GEMINI_SUBSCRIPTION_ARGS",
    fallback_models=("gemini-2.5-pro", "gemini-2.5-flash"),
)

register_provider(profile)
