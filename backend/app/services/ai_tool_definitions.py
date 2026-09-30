"""Fixed browser-tool catalogue and argument validation; no tool execution."""

from __future__ import annotations

import json
import math

MAX_ARGUMENT_CHARS = 16_000

ID = {"type": "string", "minLength": 1, "maxLength": 256}
ENDPOINTS = {
    "from_component": ID,
    "from_pin": ID,
    "to_component": ID,
    "to_pin": ID,
}


def _tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None) -> dict:
    properties = properties or {}
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": list(properties) if required is None else required,
                "additionalProperties": False,
            },
        },
    }


TOOL_DEFINITIONS = [
    _tool("get_build_result", "Read the actual current project overview, quantities, wiring, firmware, build steps, and revision-matched compilation/simulation evidence. Call before the final response."),
    _tool("get_project_state", "Inspect the current browser project, components, exact IDs and available pin names."),
    _tool("get_circuit", "Inspect the current circuit, component IDs, pins and connections."),
    _tool("search_components", "Search the actual component catalogue; use returned component_type IDs and property metadata.",
          {"query": {"type": "string", "maxLength": 500}}),
    _tool("add_component", "Add a catalogue component or supported board. Omit position for automatic placement.",
          {"component_type": ID, "position": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                                               "required": ["x", "y"], "additionalProperties": False}}, ["component_type"]),
    _tool("remove_component", "Remove an existing component and its attached connections.", {"component_id": ID}),
    _tool("set_component_property", "Set an existing property using its actual metadata and a primitive value.",
          {"component_id": ID, "property": ID, "value": {"type": ["string", "number", "boolean", "null"]}}),
    _tool("connect", "Connect exact inspected pin names on existing components.", ENDPOINTS),
    _tool("disconnect", "Remove an existing connection by wire ID.", {"wire_id": ID}),
    _tool("update_connection", "Replace an existing wire's endpoints; supply the wire ID and all four endpoints.",
          {"wire_id": ID, **ENDPOINTS}),
    _tool("get_firmware", "Inspect existing firmware files, file IDs, names, groups and content."),
    _tool("set_firmware", "Update an existing firmware file; prefer its inspected file ID.",
          {"file": ID, "content": {"type": "string", "maxLength": 2_000_000}}),
    _tool("add_firmware_file", "Create a firmware file using the existing editor; optionally select an inspected group ID.",
          {"name": ID, "content": {"type": "string", "maxLength": 2_000_000}, "group_id": ID}, ["name", "content"]),
    _tool("compile_firmware", "Compile current firmware with the editor's existing compiler and report its actual result."),
    _tool("start_simulation", "Start simulation through the editor's existing engine; this does not flash physical hardware."),
    _tool("stop_simulation", "Stop simulation through the editor's existing engine."),
    _tool("get_simulation_state", "Inspect actual simulation state and existing board engines."),
    _tool("get_serial_output", "Read actual serial monitor output; do not invent output."),
]
TOOL_SCHEMAS = {tool["function"]["name"]: tool["function"]["parameters"] for tool in TOOL_DEFINITIONS}


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate argument property")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("Arguments must use finite JSON values")


def _validate(value: object, schema: dict) -> None:
    kind = schema["type"]
    kinds = kind if isinstance(kind, list) else [kind]
    actual = (
        "null" if value is None else "boolean" if isinstance(value, bool)
        else "string" if isinstance(value, str) else "number" if isinstance(value, (int, float))
        else "object" if isinstance(value, dict) else "unsupported"
    )
    if actual not in kinds:
        raise ValueError("Invalid argument type")
    if actual == "object":
        properties = schema["properties"]
        if set(value) - set(properties) or not set(schema["required"]).issubset(value):
            raise ValueError("Invalid argument properties")
        for key, item in value.items():
            _validate(item, properties[key])
    elif actual == "string":
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", MAX_ARGUMENT_CHARS):
            raise ValueError("Invalid argument length")
        if schema.get("minLength") and (not value.strip() or any(ord(char) < 32 for char in value)):
            raise ValueError("Invalid argument identifier")
    elif actual == "number" and isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Arguments must use finite numbers")


def validate_tool_arguments(name: str, arguments: str) -> str:
    if name not in TOOL_SCHEMAS or len(arguments) > MAX_ARGUMENT_CHARS:
        raise ValueError("Unknown tool or oversized arguments")
    try:
        value = json.loads(arguments, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        _validate(value, TOOL_SCHEMAS[name])
    except (ValueError, TypeError, RecursionError, OverflowError):
        raise ValueError("Invalid tool arguments") from None
    return arguments
