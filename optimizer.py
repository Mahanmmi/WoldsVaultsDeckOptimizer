"""CLI entry points for the Wold's Vaults Deck Optimizer.

These are thin wrappers around ``NDM_Optimizer_Rust.py`` so the optimizer can
be invoked through ``uv run optimize`` / ``uv run optimize-py`` instead of
pointing at the script path explicitly.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

_SCRIPT_NAME = "NDM_Optimizer_Rust.py"


def _script_path() -> Path:
    for candidate in (
        Path.cwd() / _SCRIPT_NAME,
        Path(__file__).resolve().parent / _SCRIPT_NAME,
    ):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Could not locate {_SCRIPT_NAME}. "
        "Run the command from the project root."
    )


def main() -> None:
    """Run the optimizer using the Rust core when available."""
    runpy.run_path(str(_script_path()), run_name="__main__")


def main_no_rust() -> None:
    """Run the optimizer in pure-Python mode (Rust core disabled)."""
    # Setting the module to ``None`` in ``sys.modules`` causes any subsequent
    # ``import ndm_core`` to raise ``ImportError``, so the script's existing
    # try/except fallback path is used.
    sys.modules["ndm_core"] = None  # type: ignore[assignment]
    runpy.run_path(str(_script_path()), run_name="__main__")
