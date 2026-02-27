from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from assembler import assemble_source, run_program

try:
    from websockets.asyncio.server import serve
except ImportError:
    from websockets.server import serve  # type: ignore


def _response(message_id: str | None, msg_type: str, payload: dict[str, Any]) -> str:
    data = {"id": message_id, "type": msg_type, **payload}
    return json.dumps(data, ensure_ascii=False)


async def handle_message(raw: str) -> str:
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return _response(None, "error", {"error": "Invalid JSON"})

    message_id = message.get("id")
    msg_type = message.get("type")

    try:
        if msg_type == "ping":
            return _response(message_id, "pong", {})

        if msg_type == "assemble":
            source = message.get("source", "")
            program = assemble_source(source)
            return _response(message_id, "assembled", {"program": program})

        if msg_type == "run":
            source = message.get("source", "")
            max_steps = int(message.get("maxSteps", 1000))
            inputs = message.get("inputs", [])
            if not isinstance(inputs, list):
                raise ValueError("'inputs' must be an array")

            parsed_inputs = [int(v) for v in inputs]
            result = run_program(source=source, max_steps=max_steps, inputs=parsed_inputs)
            return _response(message_id, "result", result)

        return _response(message_id, "error", {"error": f"Unknown message type '{msg_type}'"})
    except Exception as exc:  # noqa: BLE001
        return _response(message_id, "error", {"error": str(exc)})


async def ws_handler(websocket) -> None:
    async for raw in websocket:
        response = await handle_message(raw)
        await websocket.send(response)


def _read_host_port() -> tuple[str, int]:
    host = os.getenv("CPU6502_WS_HOST", "127.0.0.1")
    port = int(os.getenv("CPU6502_WS_PORT", "8765"))
    return host, port


async def main(host: str = "127.0.0.1", port: int = 8765) -> None:
    async with serve(ws_handler, host, port):
        print(f"CPU6502 websocket server started on ws://{host}:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    ws_host, ws_port = _read_host_port()
    asyncio.run(main(ws_host, ws_port))
