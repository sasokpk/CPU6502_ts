from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from assembler import assemble_source, run_program


def _read_json(request: HttpRequest) -> dict[str, Any]:
    if not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except JSONDecodeError as exc:
        raise ValueError("Invalid JSON") from exc

    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")
    return payload


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"status": "ok"})


@csrf_exempt
@require_POST
def assemble_view(request: HttpRequest) -> JsonResponse:
    try:
        payload = _read_json(request)
        source = str(payload.get("source", ""))
        program = assemble_source(source)
        return JsonResponse({"program": program})
    except Exception as exc:  # noqa: BLE001
        return JsonResponse({"error": str(exc)}, status=400)


@csrf_exempt
@require_POST
def run_view(request: HttpRequest) -> JsonResponse:
    try:
        payload = _read_json(request)
        source = str(payload.get("source", ""))
        max_steps = int(payload.get("maxSteps", 1000))
        inputs = payload.get("inputs", [])
        if not isinstance(inputs, list):
            raise ValueError("'inputs' must be an array")

        parsed_inputs = [int(value) for value in inputs]
        result = run_program(source=source, max_steps=max_steps, inputs=parsed_inputs)
        return JsonResponse(result)
    except Exception as exc:  # noqa: BLE001
        return JsonResponse({"error": str(exc)}, status=400)
