# Installed by Pitwall. Inert unless Pitwall starts Hermes as a reviewer.
"""
A reviewer reads the change; it does not make one. When Pitwall starts Hermes
as a reviewer it sets PITWALL_HERMES_REVIEWER=1, and every tool call is held to
reading files inside the folder under review, plus Hermes's own memory and
skills — which live in its profile, not the repository, and are how it learns
the project. Everything else is blocked: writes, the terminal, code
execution, the network, the browser, delegation, MCP tools. Hermes treats a
hook that raises or hangs as a block, so a fault here fails closed.
"""
from __future__ import annotations

import os
from typing import Any

READ_ONLY_TOOLS = {"read_file", "search_files", "todo", "clarify"}
# Hermes's own notes and skills: written inside its profile, never the repository.
OWN_MEMORY_TOOLS = {"memory", "skills_list", "skill_view", "skill_manage"}
PATH_KEYS = ("path", "file_path", "directory", "dir", "root")


def _inside(root: str, candidate: str) -> bool:
    resolved = os.path.realpath(os.path.join(root, os.path.expanduser(candidate)))
    return resolved == root or resolved.startswith(root + os.sep)


def _review_gate(tool_name: str = "", args: Any = None, **_: Any):
    if os.environ.get("PITWALL_HERMES_REVIEWER") != "1":
        return None
    if tool_name in OWN_MEMORY_TOOLS:
        return None
    if tool_name not in READ_ONLY_TOOLS:
        return {"action": "block", "message": f"This is a read-only review: {tool_name} is not available. Read the files and report what you find."}
    root = os.path.realpath(os.getcwd())
    values = args if isinstance(args, dict) else {}
    for key in PATH_KEYS:
        value = values.get(key)
        if isinstance(value, str) and value and not _inside(root, value):
            return {"action": "block", "message": "This review is limited to the repository under review."}
    return None


def register(ctx: Any) -> None:
    ctx.register_hook("pre_tool_call", _review_gate)
