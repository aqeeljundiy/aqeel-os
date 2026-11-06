"""Product/maker names used in the default persona (dependency-free: imported very early)."""


def _branding():
    """Product/maker names for the persona: env AQEELOS_BRAND_NAME / AQEELOS_BRAND_MAKER, else
    config.yaml ``branding.name`` / ``branding.maker`` (profile, then root install). Neutral when unset."""
    import os
    name, maker = os.environ.get("AQEELOS_BRAND_NAME"), os.environ.get("AQEELOS_BRAND_MAKER")
    if name is None or maker is None:
        try:
            import yaml
            from pathlib import Path
            home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
            cands = [home / "config.yaml"]
            if home.parent.name == "profiles":
                cands.append(home.parent.parent / "config.yaml")
            for c in cands:
                if c.is_file():
                    b = (yaml.safe_load(c.read_text()) or {}).get("branding") or {}
                    if isinstance(b, dict) and (b.get("name") or b.get("maker")):
                        name = name if name is not None else b.get("name")
                        maker = maker if maker is not None else b.get("maker")
                        break
        except Exception:
            pass
    return (str(name or "aqeelOS").strip(), str(maker or "").strip())


BRAND_NAME, BRAND_MAKER = _branding()
_BRAND_INTRO = f"You are {BRAND_NAME}, built by {BRAND_MAKER}." if BRAND_MAKER else f"You are {BRAND_NAME}."
_BRAND_RUN = f"You run on {BRAND_NAME} (by {BRAND_MAKER})." if BRAND_MAKER else f"You run on {BRAND_NAME}."
