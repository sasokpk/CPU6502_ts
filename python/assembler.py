from __future__ import annotations

from typing import Any

from CPU import CPU6502


OPCODES = {
    "LDA": 0xA9,
    "LDX": 0xA2,
    "LDY": 0xA0,
    "ADC": 0x69,
    "SBC": 0xE9,
    "CMP": 0xC9,
    "CPX": 0xE0,
    "AND": 0x29,
    "ORA": 0x09,
    "EOR": 0x49,
    "NOP": 0xEA,
    "BRK": 0x00,
    "TAX": 0xAA,
    "BNE": 0xD0,
    "BEQ": 0xF0,
    "BCC": 0x90,
    "BCS": 0xB0,
    "BMI": 0x30,
    "BPL": 0x10,
    "BVS": 0x70,
    "BVC": 0x50,
    "CLC": 0x18,
    "JMP": 0x4C,
    "MUL": 0x07,
    "MULM": 0x14,
    "CMPC": 0xCD,
    "STA": 0x01,
    "LSA": 0x02,
    "STX": 0x03,
    "LSX": 0x04,
    "CTA": 0x05,
    "OTT": 0x06,
    "XTA": 0x08,
}

NO_ARG = {"BRK", "NOP", "XTA", "CLC", "CTA", "TAX"}
ABSOLUTE_ADDR = {"JMP"}
IMM16_OPS = {"LDA", "LDX", "LDY", "ADC", "SBC", "CMP", "CPX", "AND", "ORA", "EOR"}
BRANCH_OPS = {"BNE", "BEQ", "BCC", "BCS", "BMI", "BPL", "BVS", "BVC"}


def _instruction_size(op: str) -> int:
    if op in NO_ARG:
        return 1
    if op in IMM16_OPS or op in ABSOLUTE_ADDR:
        return 3
    return 2


def _parse_number(token: str) -> int:
    return int(token, 16)


def _parse_source(source: str) -> list[dict[str, Any]]:
    statements: list[dict[str, Any]] = []

    for raw_line in source.splitlines():
        line = raw_line.split(";", 1)[0].split("#", 1)[0].strip()
        if not line:
            continue

        if ":" in line:
            head, tail = line.split(":", 1)
            label = head.strip()
            if label:
                statements.append({"type": "label", "value": label})
            line = tail.strip()
            if not line:
                continue

        parts = line.split()
        op = parts[0].upper()
        arg = parts[1] if len(parts) > 1 else None
        if len(parts) > 2:
            raise ValueError(f"Too many tokens in line: '{raw_line}'")

        if op in OPCODES:
            statements.append({"type": "instruction", "op": op, "arg": arg})
        else:
            statements.append({"type": "byte", "value": op})

    return statements


def assemble_source(source: str) -> list[int]:
    statements = _parse_source(source)
    labels: dict[str, int] = {}
    addr = 0

    for st in statements:
        if st["type"] == "label":
            labels[st["value"]] = addr
            continue
        if st["type"] == "instruction":
            addr += _instruction_size(st["op"])
            continue
        addr += 1

    program: list[int] = []
    addr = 0

    for st in statements:
        if st["type"] == "label":
            continue

        if st["type"] == "instruction":
            op = st["op"]
            arg = st["arg"]
            program.append(OPCODES[op])
            addr += 1

            if op in NO_ARG:
                continue

            if arg is None:
                raise ValueError(f"Instruction '{op}' expects an argument")

            if arg in labels:
                target = labels[arg]
                if op in BRANCH_OPS:
                    offset = target - (addr + 1)
                    if offset < -128 or offset > 127:
                        raise ValueError(f"Branch offset out of range for '{op} {arg}': {offset}")
                    program.append(offset & 0xFF)
                    addr += 1
                elif op in ABSOLUTE_ADDR or op in IMM16_OPS:
                    program.append(target & 0xFF)
                    program.append((target >> 8) & 0xFF)
                    addr += 2
                else:
                    program.append(target & 0xFF)
                    addr += 1
                continue

            value = _parse_number(arg)
            if op in ABSOLUTE_ADDR or op in IMM16_OPS:
                program.append(value & 0xFF)
                program.append((value >> 8) & 0xFF)
                addr += 2
            else:
                program.append(value & 0xFF)
                addr += 1
            continue

        value = _parse_number(st["value"])
        program.append(value & 0xFF)
        addr += 1

    return program


def run_program(source: str, max_steps: int = 1000, inputs: list[int] | None = None) -> dict[str, Any]:
    program = assemble_source(source)

    input_values = list(inputs or [])
    outputs: list[dict[str, int]] = []

    def input_provider() -> int:
        if input_values:
            return input_values.pop(0)
        return 0

    def output_handler(value: int, addr: int) -> None:
        outputs.append({"value": value & 0xFFFF, "address": addr & 0xFFFF})

    cpu = CPU6502(input_provider=input_provider, output_handler=output_handler)

    start = 0x0000
    for idx, byte in enumerate(program):
        cpu.memory[start + idx] = byte & 0xFF
    cpu._PC = start
    # Track only runtime-written memory cells (exclude loaded program bytes).
    occupied_addresses: set[int] = set()

    def snapshot_occupied_memory() -> list[dict[str, int]]:
        return [{"address": addr & 0xFFFF, "value": cpu.memory[addr] & 0xFF} for addr in sorted(occupied_addresses)]

    trace: list[dict[str, Any]] = []
    halted = False
    error: str | None = None

    for step in range(1, max_steps + 1):
        before = cpu.snapshot()
        op = cpu.memory[cpu._PC]

        if op in {0x01, 0x03, 0x14}:  # STA/STX/MULM write two bytes to memory
            target = cpu.memory[(cpu._PC + 1) & 0xFFFF]
            occupied_addresses.add(target & 0xFFFF)
            occupied_addresses.add((target + 1) & 0xFFFF)

        try:
            cont = cpu.execute_instructions()
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
            trace.append(
                {
                    "step": step,
                    "opcode": op,
                    "before": before,
                    "error": error,
                    "memory_used": snapshot_occupied_memory(),
                }
            )
            break

        after = cpu.snapshot()
        trace.append(
            {
                "step": step,
                "opcode": op,
                "before": before,
                "after": after,
                "halted": not cont,
                "memory_used": snapshot_occupied_memory(),
            }
        )

        if not cont:
            halted = True
            break
    else:
        error = f"Exceeded max_steps={max_steps}"

    return {
        "program": program,
        "trace": trace,
        "halted": halted,
        "error": error,
        "outputs": outputs,
        "final_state": cpu.snapshot(),
    }
